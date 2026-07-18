from datetime import timedelta
import asyncio
from temporalio import workflow
from typing import List, Dict, Any, Optional
import json

with workflow.unsafe.imports_passed_through():
    from . import activities

@workflow.defn
class OrderSupervisorWorkflow:
    def __init__(self):
        self.is_completed = False
        self.is_paused = False
        self.pending_events = []
        self.unprocessed_events_for_agent = []
        self.run_status = "active"
        self.memory_summary = "Workflow started."
        self.instructions = []
        self.run_id = ""
        self.order_id = ""
        self.sleep_duration = None
        
    @workflow.run
    async def run(self, order_id: str, base_instruction: str) -> Dict[str, Any]:
        self.order_id = order_id
        self.run_id = workflow.info().workflow_id
        self.instructions.append(base_instruction)
        workflow.logger.info(f"Started order supervisor for order {order_id} (run: {self.run_id})")
        
        # Initial memory update
        await workflow.execute_activity(
            activities.update_run_memory,
            {"run_id": self.run_id, "memory": self.memory_summary, "status": self.run_status},
            start_to_close_timeout=timedelta(minutes=1)
        )
        
        while not self.is_completed:
            workflow.logger.info("Supervisor sleeping...")
            
            # If paused, wait until resumed
            if self.is_paused:
                await workflow.wait_condition(lambda: not self.is_paused)
                
            # Wait for events or timeout
            # We wait until pending_events is not empty or workflow is completed
            try:
                if self.sleep_duration:
                    await workflow.wait_condition(
                        lambda: len(self.pending_events) > 0 or self.is_completed,
                        timeout=self.sleep_duration
                    )
                else:
                    await workflow.wait_condition(
                        lambda: len(self.pending_events) > 0 or self.is_completed
                    )
            except asyncio.TimeoutError:
                workflow.logger.info("Scheduled wake up reached.")
            
            if self.is_completed:
                break
                
            wake_agent = False
            
            # If we woke up due to timeout, we must run the agent
            if len(self.pending_events) == 0:
                wake_agent = True
            
            # Process events
            events_to_classify = list(self.pending_events)
            self.pending_events.clear()
            
            for event in events_to_classify:
                # Log event
                await workflow.execute_activity(
                    activities.log_event_activity,
                    {"run_id": self.run_id, "type": "event", "content": event},
                    start_to_close_timeout=timedelta(minutes=1)
                )
                
                await asyncio.sleep(1.5)
                
                self.unprocessed_events_for_agent.append(event)
                
                # Manual terminations/interrupts bypass classifier
                if event.get("type") in ["system_terminate", "manual_instruction"]:
                    wake_agent = True
                    if event.get("type") == "system_terminate":
                        self.is_completed = True
                        self.run_status = "terminated"
                else:
                    # Run classifier
                    should_wake = await workflow.execute_activity(
                        activities.llm_classify_event,
                        {"event": event, "memory": self.memory_summary},
                        start_to_close_timeout=timedelta(minutes=1)
                    )
                    
                    await workflow.execute_activity(
                        activities.log_event_activity,
                        {"run_id": self.run_id, "type": "wake_decision", "content": {"event_type": event.get("type"), "wake": should_wake}},
                        start_to_close_timeout=timedelta(minutes=1)
                    )
                    
                    await asyncio.sleep(1.5)
                    
                    if should_wake:
                        wake_agent = True
            
            if self.is_completed:
                break
                
            if wake_agent:
                workflow.logger.info("Agent is awake. Running inference...")
                # Run Agent inference
                agent_result = await workflow.execute_activity(
                    activities.llm_agent_inference,
                    {
                        "order_id": self.order_id,
                        "events": self.unprocessed_events_for_agent,
                        "memory": self.memory_summary,
                        "instructions": self.instructions
                    },
                    start_to_close_timeout=timedelta(minutes=5)
                )
                
                # Clear events since agent saw them
                self.unprocessed_events_for_agent.clear()
                
                # Process actions
                actions = agent_result.get("actions", [])
                for action in actions:
                    tool_name = action.get("tool")
                    params = action.get("params", {})
                    params["run_id"] = self.run_id
                    
                    tool_map = {
                        "message_fulfillment_team": activities.message_fulfillment_team,
                        "message_payments_team": activities.message_payments_team,
                        "message_logistics_team": activities.message_logistics_team,
                        "message_customer": activities.message_customer,
                        "create_internal_note": activities.create_internal_note
                    }
                    
                    if tool_name in tool_map:
                        await workflow.execute_activity(
                            tool_map[tool_name],
                            params,
                            start_to_close_timeout=timedelta(minutes=2)
                        )
                        await asyncio.sleep(1.5)
                    else:
                        workflow.logger.warning(f"Unknown tool requested: {tool_name}")
                
                # Update memory
                self.memory_summary = agent_result.get("new_memory_summary", self.memory_summary)
                
                # Handle terminal state
                if agent_result.get("terminal", False):
                    self.is_completed = True
                    self.run_status = "completed"
                
                # Update DB state
                await workflow.execute_activity(
                    activities.update_run_memory,
                    {"run_id": self.run_id, "memory": self.memory_summary, "status": self.run_status},
                    start_to_close_timeout=timedelta(minutes=1)
                )
                
                # Handle sleep instruction (simplification for POC)
                sleep_instr = agent_result.get("sleep_instruction", "Wait for next signal")
                await workflow.execute_activity(
                    activities.log_event_activity,
                    {"run_id": self.run_id, "type": "sleep_decision", "content": {"instruction": sleep_instr}},
                    start_to_close_timeout=timedelta(minutes=1)
                )
                
                # In a real app we'd parse the string to a timedelta. 
                # For POC, if it mentions "1 hour", we could parse it, but we'll default to None (wait for signal)
                self.sleep_duration = None
                if "hour" in sleep_instr.lower():
                    self.sleep_duration = timedelta(hours=1)
                elif "minute" in sleep_instr.lower():
                    self.sleep_duration = timedelta(minutes=5)
        
        # Final summary
        return {
            "status": self.run_status,
            "memory": self.memory_summary,
            "final_summary": "Order processing complete.",
        }
        
    @workflow.signal
    async def receive_event(self, event: Dict[str, Any]):
        self.pending_events.append(event)
        
    @workflow.signal
    async def update_instructions(self, instruction: str):
        self.instructions.append(instruction)
        self.pending_events.append({"type": "manual_instruction", "content": {"instruction": instruction}})
        
    @workflow.signal
    async def terminate(self):
        self.pending_events.append({"type": "system_terminate"})
        
    @workflow.signal
    async def pause(self):
        self.is_paused = True
        
    @workflow.signal
    async def resume(self):
        self.is_paused = False
