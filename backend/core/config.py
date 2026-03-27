from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    senso_key: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    database_url: str = "sqlite+aiosqlite:///./decisions.db"
    cycle_interval_seconds: int = 30
    overclaw_optimize_every_n: int = 10

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
