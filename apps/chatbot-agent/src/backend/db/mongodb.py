import logging
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic_settings import BaseSettings
import asyncio

logger = logging.getLogger(__name__)

class MongoDBSettings(BaseSettings):
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "ai_chat"
    
    class Config:
        env_file = ".env"
        extra = "ignore"

class MongoDB:
    client: AsyncIOMotorClient = None
    db = None
    _initialized = False
    
    def __init__(self):
        self.settings = MongoDBSettings()
        # Không kết nối ngay tại đây, chờ đến khi gọi connect_to_mongodb

    @classmethod
    async def connect_to_mongodb(cls):
        settings = MongoDBSettings()
        logger.info(f"Connecting to MongoDB at {settings.MONGODB_URL}")
        
        cls.client = AsyncIOMotorClient(settings.MONGODB_URL)
        cls.db = cls.client[settings.MONGODB_DB_NAME]
        cls._initialized = True
        
        # Cập nhật mongodb instance global
        global mongodb
        mongodb.client = cls.client
        mongodb.db = cls.db
        
        logger.info("Connected to MongoDB")
        
        # Kiểm tra danh sách collections
        collections = await cls.db.list_collection_names()
        logger.info(f"Collections in DB: {collections}")
        
        if 'users' in collections:
            logger.info("Collection 'users' exists.")
        else:
            logger.warning("Collection 'users' not found. It will be created on first insert.")
            
        # Tạo index cho rate_limits collection
        try:
            await cls.db.rate_limits.create_index("user_id", unique=True)
            logger.info("Created index for rate_limits collection on user_id field")
        except Exception as e:
            logger.warning(f"Error creating index for rate_limits: {e}")
    
    @classmethod
    async def close_mongodb_connection(cls):
        if cls.client:
            logger.info("Closing MongoDB connection")
            cls.client.close()
            cls.client = None
            cls.db = None
            cls._initialized = False
            
            # Cập nhật mongodb instance global
            global mongodb
            mongodb.client = None
            mongodb.db = None
            
            logger.info("MongoDB connection closed")

    # Đảm bảo kết nối MongoDB đã được thiết lập
    @classmethod
    async def ensure_connection(cls):
        if not cls._initialized or cls.db is None:
            await cls.connect_to_mongodb()
        return cls.db

    # Convenience properties
    @property
    def conversations(self):
        if self.db is None and MongoDB.db is not None:
            return MongoDB.db.conversations
        return self.db.conversations if self.db else None

    @property
    def users(self):
        if self.db is None and MongoDB.db is not None:
            return MongoDB.db.users
        return self.db.users if self.db else None

    @property
    def messages(self):
        if self.db is None and MongoDB.db is not None:
            return MongoDB.db.messages
        return self.db.messages if self.db else None
    
    @property
    def rate_limits(self):
        if self.db is None and MongoDB.db is not None:
            return MongoDB.db.rate_limits
        return self.db.rate_limits if self.db else None

# Khởi tạo một singleton instance

# Tạo instance global
mongodb = MongoDB()

# Hàm helper để lấy DB một cách an toàn
async def get_db():
    """
    Hàm helper để lấy database connection.
    Sẽ tự động kết nối nếu chưa kết nối.
    """
    if MongoDB.db is None:
        await MongoDB.connect_to_mongodb()
    return MongoDB.db
