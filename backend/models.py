from sqlalchemy import Column, String, Integer, DateTime, JSON, ForeignKey
from sqlalchemy.sql import func
from .database import Base

class SupervisorTemplate(Base):
    __tablename__ = "supervisors"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    base_instruction = Column(String)
    tools = Column(JSON) # e.g. ["message_customer", "escalate"]
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class RunRecord(Base):
    __tablename__ = "runs"
    id = Column(String, primary_key=True) # Workflow ID
    supervisor_id = Column(Integer, ForeignKey("supervisors.id"), nullable=True)
    status = Column(String) # active, completed, terminated
    memory_summary = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, ForeignKey("runs.id"))
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    type = Column(String) # event, wake_decision, sleep_decision, agent_action, manual_instruction
    content = Column(JSON)
