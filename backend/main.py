import uuid
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from temporalio.client import Client
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .workflows import OrderSupervisorWorkflow
from .database import get_db
from .models import SupervisorTemplate, RunRecord, ActivityLog
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For POC
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def get_temporal_client():
    return await Client.connect("localhost:7233")

# --- Schemas ---
class SupervisorCreate(BaseModel):
    name: str
    base_instruction: str
    tools: List[str]

class SupervisorResponse(SupervisorCreate):
    id: int

class StartRunRequest(BaseModel):
    order_id: str
    supervisor_id: int

class EventRequest(BaseModel):
    type: str
    data: Dict[str, Any] = {}

class InstructionRequest(BaseModel):
    instruction: str

# --- Endpoints ---
@app.post("/api/supervisors", response_model=SupervisorResponse)
async def create_supervisor(sup: SupervisorCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(SupervisorTemplate).where(SupervisorTemplate.name == sup.name))
    existing_sup = existing.scalars().first()
    if existing_sup:
        return existing_sup

    db_sup = SupervisorTemplate(
        name=sup.name, 
        base_instruction=sup.base_instruction, 
        tools=sup.tools
    )
    db.add(db_sup)
    await db.commit()
    await db.refresh(db_sup)
    return db_sup

@app.get("/api/supervisors", response_model=List[SupervisorResponse])
async def list_supervisors(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SupervisorTemplate))
    return result.scalars().all()

@app.post("/api/runs")
async def start_run(req: StartRunRequest, db: AsyncSession = Depends(get_db)):
    sup = await db.get(SupervisorTemplate, req.supervisor_id)
    if not sup:
        raise HTTPException(status_code=404, detail="Supervisor not found")
        
    client = await get_temporal_client()
    run_id_str = f"order-supervisor-{req.order_id}-{uuid.uuid4().hex[:6]}"
    
    # Create DB Record
    db_run = RunRecord(
        id=run_id_str,
        supervisor_id=sup.id,
        status="active",
        memory_summary="Workflow started."
    )
    db.add(db_run)
    await db.commit()
    
    try:
        handle = await client.start_workflow(
            OrderSupervisorWorkflow.run,
            args=[req.order_id, sup.base_instruction],
            id=run_id_str,
            task_queue="order-supervisor-queue",
        )
        return {"run_id": handle.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/runs")
async def list_runs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RunRecord).order_by(RunRecord.created_at.desc()))
    runs = result.scalars().all()

    run_list = []
    for run in runs:
        last_act_result = await db.execute(
            select(ActivityLog)
            .where(ActivityLog.run_id == run.id)
            .where(~ActivityLog.type.in_(['sleep_decision', 'wake_decision']))
            .order_by(ActivityLog.timestamp.desc())
            .limit(1)
        )
        last_act = last_act_result.scalars().first()
        run_list.append({
            "id": run.id,
            "supervisor_id": run.supervisor_id,
            "status": run.status,
            "memory_summary": run.memory_summary,
            "created_at": run.created_at,
            "updated_at": run.updated_at,
            "last_event_type": last_act.type if last_act else None,
            "last_event_content": last_act.content if last_act else None,
            "last_event_at": last_act.timestamp if last_act else None,
        })
    return run_list

@app.get("/api/runs/{run_id}")
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(RunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # Get activities
    result = await db.execute(select(ActivityLog).where(ActivityLog.run_id == run_id).order_by(ActivityLog.timestamp.asc()))
    activities = result.scalars().all()
    
    return {
        "run": run,
        "activities": activities
    }

@app.post("/api/runs/{run_id}/events")
async def send_event(run_id: str, event: EventRequest):
    client = await get_temporal_client()
    try:
        handle = client.get_workflow_handle(run_id)
        # Convert Pydantic to dict properly without passing the whole object
        event_dict = {"type": event.type, "data": event.data}
        await handle.signal(OrderSupervisorWorkflow.receive_event, event_dict)
        return {"status": "event sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/runs/{run_id}/instructions")
async def send_instruction(run_id: str, req: InstructionRequest):
    client = await get_temporal_client()
    try:
        handle = client.get_workflow_handle(run_id)
        await handle.signal(OrderSupervisorWorkflow.update_instructions, req.instruction)
        return {"status": "instruction sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/runs/{run_id}/terminate")
async def terminate_run(run_id: str):
    client = await get_temporal_client()
    try:
        handle = client.get_workflow_handle(run_id)
        await handle.signal(OrderSupervisorWorkflow.terminate)
        return {"status": "termination signaled"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/runs/{run_id}/pause")
async def pause_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(RunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
        
    client = await get_temporal_client()
    try:
        handle = client.get_workflow_handle(run_id)
        await handle.signal(OrderSupervisorWorkflow.pause)
        
        run.status = "paused"
        await db.commit()
        
        return {"status": "paused"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/runs/{run_id}/resume")
async def resume_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(RunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
        
    client = await get_temporal_client()
    try:
        handle = client.get_workflow_handle(run_id)
        await handle.signal(OrderSupervisorWorkflow.resume)
        
        run.status = "active"
        await db.commit()
        
        return {"status": "resumed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
