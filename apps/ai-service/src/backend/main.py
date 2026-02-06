import asyncio
import logging
import os
import uvicorn
from contextlib import asynccontextmanager
from datetime import datetime
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Force Allow Duplicate Lib for some ML envs
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from .api import router as api_router

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# RabbitMQ consumer task
_consumer_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown events"""
    global _consumer_task

    # Startup: Start RabbitMQ consumer if RABBITMQ_URL is set
    rabbitmq_url = os.getenv("RABBITMQ_URL")
    if rabbitmq_url:
        try:
            from .rabbitmq_consumer import get_consumer
            consumer = get_consumer()
            _consumer_task = asyncio.create_task(consumer.start_consuming())
            logger.info("RabbitMQ consumer started")
        except Exception as e:
            # Soft fail: Log error but let the app start. 
            # This prevents dev environment from crashing due to AMQP issues.
            logger.error(f"Failed to start RabbitMQ consumer (Optional): {e}")
            _consumer_task = None

    yield

    # Shutdown: Close RabbitMQ consumer
    if _consumer_task:
        _consumer_task.cancel()
        try:
            await _consumer_task
        except asyncio.CancelledError:
            pass
        logger.info("RabbitMQ consumer stopped")


# Create FastAPI app with lifespan
app = FastAPI(
    title="Examio AI Stateless Node",
    description="Stateless service for OCR, Vector Search, and AI Queries",
    version="2.0.0",
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(api_router, prefix="/api")

# Custom exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.detail,
            "status_code": exc.status_code
        },
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "Internal server error",
            "message": str(exc)
        },
    )

@app.get("/")
async def root():
    return {
        "service": "Examio AI Node",
        "status": "online",
        "version": "2.0.0"
    }

@app.get("/health")
async def health_check():
    """Simple health check without DB dependencies for the node itself"""
    return {"status": "healthy", "timestamp": str(datetime.now()) if 'datetime' in globals() else "now"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3434))
    logger.info(f"Starting Examio AI Node on port {port}")
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
