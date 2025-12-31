"""
RabbitMQ Consumer for OCR Tasks

This module consumes OCR_REQUESTED events from RabbitMQ and processes files.
After processing, it publishes OCR_COMPLETED or OCR_FAILED events.
"""
import asyncio
import json
import logging
import os
from typing import Any, Dict

import aio_pika
from aio_pika import connect_robust, IncomingMessage

from src.backend.services.ocr_service import ocr_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://localhost:5672")
EXCHANGE_NAME = "examio.events"
QUEUE_NAME = "ai-service-queue"
ROUTING_KEY = "ai.ocr.requested"


class RabbitMQConsumer:
    """Async RabbitMQ consumer for OCR tasks"""

    def __init__(self):
        self.connection = None
        self.channel = None
        self.exchange = None
        self.queue = None

    async def connect(self):
        """Establish connection to RabbitMQ"""
        logger.info(f"Connecting to RabbitMQ at {RABBITMQ_URL}")
        self.connection = await connect_robust(RABBITMQ_URL)
        logger.info("RabbitMQ connection established")
        self.channel = await self.connection.channel()
        logger.info("RabbitMQ channel created")

        # Declare exchange
        self.exchange = await self.channel.declare_exchange(
            EXCHANGE_NAME,
            aio_pika.ExchangeType.TOPIC,
            durable=True,
        )
        logger.info(f"Exchange {EXCHANGE_NAME} declared")

        # Declare queue
        self.queue = await self.channel.declare_queue(
            QUEUE_NAME,
            durable=True,
        )
        logger.info(f"Queue {QUEUE_NAME} declared")

        # Bind queue to exchange with routing key
        await self.queue.bind(self.exchange, routing_key=ROUTING_KEY)
        logger.info(f"Bound queue {QUEUE_NAME} to exchange {EXCHANGE_NAME} with key {ROUTING_KEY}")

    async def process_message(self, message: IncomingMessage):
        """Process incoming OCR request message"""
        logger.info(f"=== RECEIVED MESSAGE ===")
        logger.info(f"Routing key: {message.routing_key}")
        logger.info(f"Body: {message.body.decode()}")
        async with message.process():
            try:
                body = json.loads(message.body.decode())
                logger.info(f"Received OCR request: {body}")

                payload = body.get("payload", {})
                user_storage_id = payload.get("userStorageId")
                user_id = payload.get("userId")
                file_url = payload.get("fileUrl")
                file_name = payload.get("fileName")

                # Generation params (for auto-generate after OCR)
                type_result = payload.get("typeResult", 1)  # 1=quiz, 2=flashcard
                quantity_quizz = payload.get("quantityQuizz", 10)
                quantity_flashcard = payload.get("quantityFlashcard", 10)

                if not user_storage_id:
                    logger.error("Missing userStorageId in message")
                    return

                logger.info(f"Processing OCR for userStorageId: {user_storage_id}")

                # Get file info and process OCR
                file_info = await ocr_service.get_file_info(user_storage_id)
                if not file_info:
                    logger.error(f"File not found: {user_storage_id}")
                    await self.publish_ocr_failed(user_storage_id, user_id, "File not found")
                    return

                # Check if already processed
                if file_info.processing_status == "COMPLETED":
                    logger.info(f"File already processed: {user_storage_id}")
                    return

                # Update status to PROCESSING
                await ocr_service.update_file_status(user_storage_id, "PROCESSING")

                # Perform OCR
                result = await ocr_service.process_file(user_storage_id)

                if result.get("success"):
                    chunks_count = result.get("chunks_count", 0)
                    logger.info(f"OCR completed for {user_storage_id}: {chunks_count} chunks")

                    # Auto-generate quiz/flashcard after OCR
                    await self.auto_generate_content(
                        user_storage_id,
                        user_id,
                        type_result,
                        quantity_quizz,
                        quantity_flashcard
                    )
                else:
                    error = result.get("error", "Unknown error")
                    await self.publish_ocr_failed(user_storage_id, user_id, error)
                    logger.error(f"OCR failed for {user_storage_id}: {error}")

            except Exception as e:
                logger.exception(f"Error processing message: {e}")

    async def auto_generate_content(
        self,
        user_storage_id: str,
        user_id: str,
        type_result: int,
        quantity_quizz: int,
        quantity_flashcard: int
    ):
        """
        Auto-generate quiz or flashcard after OCR completes.
        type_result: 1=quiz, 2=flashcard
        """
        try:
            from src.backend.services.generation_service import (
                generation_service,
                GenerateQuizRequest,
                GenerateFlashcardRequest
            )

            if type_result == 2:
                # Generate flashcards
                logger.info(f"Auto-generating {quantity_flashcard} flashcards for {user_storage_id}")
                request = GenerateFlashcardRequest(
                    user_storage_id=user_storage_id,
                    user_id=user_id,
                    num_flashcards=quantity_flashcard
                )
                result = await generation_service.generate_flashcards(request)
            else:
                # Generate quiz (default)
                logger.info(f"Auto-generating {quantity_quizz} quiz questions for {user_storage_id}")
                request = GenerateQuizRequest(
                    user_storage_id=user_storage_id,
                    user_id=user_id,
                    num_questions=quantity_quizz
                )
                result = await generation_service.generate_quiz(request)

            if result.get("success"):
                logger.info(f"Content generation completed for {user_storage_id}")
                # Publish completion event with result
                await self.publish_generation_completed(
                    user_storage_id,
                    user_id,
                    type_result,
                    result.get("history_id")
                )
            else:
                error = result.get("error", "Unknown error")
                logger.error(f"Content generation failed for {user_storage_id}: {error}")
                await self.publish_generation_failed(user_storage_id, user_id, error)

        except Exception as e:
            logger.exception(f"Error in auto_generate_content for {user_storage_id}: {e}")
            await self.publish_generation_failed(user_storage_id, user_id, str(e))

    async def publish_generation_completed(
        self,
        user_storage_id: str,
        user_id: str,
        type_result: int,
        history_id: str
    ):
        """Publish GENERATION_COMPLETED event"""
        event = {
            "type": "generation.completed",
            "timestamp": int(asyncio.get_event_loop().time() * 1000),
            "payload": {
                "userStorageId": user_storage_id,
                "userId": user_id,
                "typeResult": type_result,
                "historyId": history_id,
            },
            "metadata": {
                "sourceService": "ai-service",
            },
        }
        await self.exchange.publish(
            aio_pika.Message(body=json.dumps(event).encode()),
            routing_key="ai.generation.completed",
        )
        logger.info(f"Published generation.completed for {user_storage_id}")

    async def publish_generation_failed(self, user_storage_id: str, user_id: str, error: str):
        """Publish GENERATION_FAILED event"""
        event = {
            "type": "generation.failed",
            "timestamp": int(asyncio.get_event_loop().time() * 1000),
            "payload": {
                "userStorageId": user_storage_id,
                "userId": user_id,
                "error": error,
            },
            "metadata": {
                "sourceService": "ai-service",
            },
        }
        await self.exchange.publish(
            aio_pika.Message(body=json.dumps(event).encode()),
            routing_key="ai.generation.failed",
        )
        logger.error(f"Published generation.failed for {user_storage_id}: {error}")

    async def publish_ocr_completed(self, user_storage_id: str, user_id: str, chunks_count: int):
        """Publish OCR_COMPLETED event"""
        event = {
            "type": "ocr.completed",
            "timestamp": int(asyncio.get_event_loop().time() * 1000),
            "payload": {
                "userStorageId": user_storage_id,
                "userId": user_id,
                "chunksCount": chunks_count,
            },
            "metadata": {
                "sourceService": "ai-service",
            },
        }
        await self.exchange.publish(
            aio_pika.Message(body=json.dumps(event).encode()),
            routing_key="ai.ocr.completed",
        )

    async def publish_ocr_failed(self, user_storage_id: str, user_id: str, error: str):
        """Publish OCR_FAILED event"""
        event = {
            "type": "ocr.failed",
            "timestamp": int(asyncio.get_event_loop().time() * 1000),
            "payload": {
                "userStorageId": user_storage_id,
                "userId": user_id,
                "error": error,
            },
            "metadata": {
                "sourceService": "ai-service",
            },
        }
        await self.exchange.publish(
            aio_pika.Message(body=json.dumps(event).encode()),
            routing_key="ai.ocr.failed",
        )

    async def start_consuming(self):
        """Start consuming messages from queue"""
        await self.connect()
        logger.info("Starting to consume OCR requests...")
        await self.queue.consume(self.process_message)
        logger.info("Consumer is now listening for messages...")
        # Keep the consumer running
        try:
            await asyncio.Future()  # Run forever
        except asyncio.CancelledError:
            logger.info("Consumer cancelled, closing...")
            await self.close()

    async def close(self):
        """Close connection"""
        if self.connection:
            await self.connection.close()


# Singleton instance
_consumer: RabbitMQConsumer = None


def get_consumer() -> RabbitMQConsumer:
    """Get or create RabbitMQ consumer instance"""
    global _consumer
    if _consumer is None:
        _consumer = RabbitMQConsumer()
    return _consumer


async def start_consumer():
    """Start the RabbitMQ consumer (call from main.py)"""
    consumer = get_consumer()
    await consumer.start_consuming()


if __name__ == "__main__":
    # For standalone testing
    async def main():
        consumer = RabbitMQConsumer()
        try:
            await consumer.start_consuming()
            # Keep running
            await asyncio.Future()
        except KeyboardInterrupt:
            await consumer.close()

    asyncio.run(main())
