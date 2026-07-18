import os
import json
from groq import AsyncGroq
from typing import Dict, Any, List

# Load API key from env
client = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""))

async def classify_event(event: Dict[str, Any], memory_summary: str) -> bool:
    """
    Lightweight classifier to determine if an event should wake the main agent immediately.
    """
    event_str = json.dumps(event)
    prompt = f"""
    You are a lightweight event classifier for an order supervisor.
    Current memory summary: {memory_summary}
    New event received: {event_str}
    
    Should the main AI agent wake up immediately to process this event?
    Consider events like payment failures, shipment delays, refund requests, or customer messages as urgent.
    Routine events (like order created, unless actions are immediately needed) might be less urgent, but for this POC, default to True for most things.
    
    Output ONLY valid JSON in this format: {{"wake": true/false}}
    """
    
    try:
        response = await client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            response_format={"type": "json_object"},
            temperature=0
        )
        result = json.loads(response.choices[0].message.content)
        return result.get("wake", True)
    except Exception as e:
        print(f"Classifier error: {e}")
        return True # Default to waking up on error

async def run_agent_cycle(
    order_id: str, 
    events: List[Dict[str, Any]], 
    memory_summary: str, 
    instructions: List[str]
) -> Dict[str, Any]:
    """
    Main agent reasoning loop.
    Returns:
    {
        "actions": [{"tool": "tool_name", "params": {...}}],
        "new_memory_summary": "updated summary",
        "sleep_instruction": "Wait for next signal",
        "terminal": true/false (if workflow should end)
    }
    """
    events_str = json.dumps(events, indent=2)
    instructions_str = "\n".join([f"- {i}" for i in instructions])
    
    prompt = f"""
    You are the main AI order supervisor.
    
    Order ID: {order_id}
    Base Instructions:
    {instructions_str}
    
    Current Memory Summary:
    {memory_summary}
    
    New Events to process:
    {events_str}
    
    You have the following tools available:
    1. message_fulfillment_team(message: str)
    2. message_payments_team(message: str)
    3. message_logistics_team(message: str)
    4. message_customer(message: str)
    5. create_internal_note(note: str)
    
    Your task:
    1. Decide which tools to call based on the events. You can call 0 or more tools.
    2. Provide an updated compact memory summary incorporating the new events and your actions.
    3. Decide on a sleep instruction (e.g., "Wait for next signal" or "Sleep for 1 hour").
    4. Determine if the order has reached a terminal state (e.g., delivered, fully refunded) and the workflow should be completed.
    
    Output ONLY valid JSON in the exact following format:
    {{
        "actions": [
            {{"tool": "message_customer", "params": {{"message": "Your payment failed."}}}}
        ],
        "new_memory_summary": "Order created, payment failed, messaged customer.",
        "sleep_instruction": "Wait for next signal",
        "terminal": false
    }}
    """
    
    try:
        response = await client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            response_format={"type": "json_object"},
            temperature=0.1
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"Agent error: {e}")
        return {
            "actions": [],
            "new_memory_summary": memory_summary + f" (Error processing events: {str(e)})",
            "sleep_instruction": "Wait for next signal",
            "terminal": False
        }
