import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the backend directory so GROQ_API_KEY is available
load_dotenv(Path(__file__).parent / ".env")

from temporalio.client import Client
from temporalio.worker import Worker

from .workflows import OrderSupervisorWorkflow
from .activities import (
    message_fulfillment_team,
    message_payments_team,
    message_logistics_team,
    message_customer,
    create_internal_note,
    log_event_activity,
    update_run_memory,
    llm_classify_event,
    llm_agent_inference
)
from .database import init_db

async def main():
    # Initialize Database tables
    print("Initializing Database...")
    await init_db()
    
    client = await Client.connect("localhost:7233")
    worker = Worker(
        client,
        task_queue="order-supervisor-queue",
        workflows=[OrderSupervisorWorkflow],
        activities=[
            message_fulfillment_team,
            message_payments_team,
            message_logistics_team,
            message_customer,
            create_internal_note,
            log_event_activity,
            update_run_memory,
            llm_classify_event,
            llm_agent_inference
        ]
    )
    print("Starting Temporal worker...")
    await worker.run()

if __name__ == "__main__":
    asyncio.run(main())
