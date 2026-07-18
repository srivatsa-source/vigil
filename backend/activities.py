from temporalio import activity
from typing import Dict, Any, List
from .database import async_session
from .models import ActivityLog
import json
from . import agent

async def log_activity_to_db(run_id: str, act_type: str, content: Dict[str, Any]):
    async with async_session() as session:
        log = ActivityLog(
            run_id=run_id,
            type=act_type,
            content=content
        )
        session.add(log)
        await session.commit()

@activity.defn
async def log_event_activity(params: Dict[str, Any]) -> str:
    """Generic activity to log events, wake decisions, etc. to DB."""
    run_id = params.get("run_id")
    act_type = params.get("type")
    content = params.get("content", {})
    await log_activity_to_db(run_id, act_type, content)
    return "Logged"

@activity.defn
async def update_run_memory(params: Dict[str, Any]) -> str:
    """Updates the run's memory summary in the DB."""
    from .models import RunRecord
    run_id = params.get("run_id")
    memory = params.get("memory")
    status = params.get("status")
    async with async_session() as session:
        run = await session.get(RunRecord, run_id)
        if run:
            if memory is not None:
                run.memory_summary = memory
            if status is not None:
                run.status = status
            await session.commit()
    return "Memory updated"

@activity.defn
async def llm_classify_event(params: Dict[str, Any]) -> bool:
    """Calls Groq to classify if an event should wake the agent."""
    event = params.get("event", {})
    memory = params.get("memory", "")
    return await agent.classify_event(event, memory)

@activity.defn
async def llm_agent_inference(params: Dict[str, Any]) -> Dict[str, Any]:
    """Calls Groq for main agent reasoning."""
    order_id = params.get("order_id")
    events = params.get("events", [])
    memory = params.get("memory", "")
    instructions = params.get("instructions", [])
    return await agent.run_agent_cycle(order_id, events, memory, instructions)

@activity.defn
async def message_fulfillment_team(params: Dict[str, Any]) -> str:
    run_id = params.get("run_id")
    message = params.get("message", "")
    activity.logger.info(f"Mock: Messaging fulfillment team: {message}")
    await log_activity_to_db(run_id, "agent_action", {"tool": "message_fulfillment_team", "message": message})
    return "Fulfillment team messaged"

@activity.defn
async def message_payments_team(params: Dict[str, Any]) -> str:
    run_id = params.get("run_id")
    message = params.get("message", "")
    activity.logger.info(f"Mock: Messaging payments team: {message}")
    await log_activity_to_db(run_id, "agent_action", {"tool": "message_payments_team", "message": message})
    return "Payments team messaged"

@activity.defn
async def message_logistics_team(params: Dict[str, Any]) -> str:
    run_id = params.get("run_id")
    message = params.get("message", "")
    activity.logger.info(f"Mock: Messaging logistics team: {message}")
    await log_activity_to_db(run_id, "agent_action", {"tool": "message_logistics_team", "message": message})
    return "Logistics team messaged"

@activity.defn
async def message_customer(params: Dict[str, Any]) -> str:
    run_id = params.get("run_id")
    message = params.get("message", "")
    activity.logger.info(f"Mock: Messaging customer: {message}")
    await log_activity_to_db(run_id, "agent_action", {"tool": "message_customer", "message": message})
    return "Customer messaged"

@activity.defn
async def create_internal_note(params: Dict[str, Any]) -> str:
    run_id = params.get("run_id")
    note = params.get("note", "")
    activity.logger.info(f"Mock: Creating internal note: {note}")
    await log_activity_to_db(run_id, "agent_action", {"tool": "create_internal_note", "note": note})
    return "Internal note created"
