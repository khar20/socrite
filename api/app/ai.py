import httpx

from app.config import settings


class AIProviderError(RuntimeError):
    pass


async def request_ai(path: str, payload: dict) -> dict:
    if not settings.ai_configured:
        raise AIProviderError("AI provider is not configured")
    url = f"{settings.ai_base_url.rstrip('/')}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60)) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {settings.ai_api_key}"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise AIProviderError("The AI provider returned an invalid response")
            return data
    except (httpx.HTTPError, ValueError) as exc:
        raise AIProviderError("The AI provider request failed") from exc


async def embed_texts(texts: list[str]) -> list[list[float]]:
    data = await request_ai("embeddings", {"model": settings.ai_embedding_model, "input": texts})
    try:
        rows = data["data"]
        embeddings = [row["embedding"] for row in sorted(rows, key=lambda row: row["index"])]
    except (KeyError, TypeError) as exc:
        raise AIProviderError("The AI provider returned an invalid embeddings response") from exc
    if any(len(embedding) != 1536 for embedding in embeddings):
        raise AIProviderError("The configured embedding model must return 1536 dimensions")
    return embeddings


async def generate_question(context: str) -> str:
    data = await request_ai("chat/completions", {
        "model": settings.ai_chat_model,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": (
                "Write one open-ended university learning question in Spanish using only the source. "
                "Ask for reasoning, not only a result. Return only the question."
            )},
            {"role": "user", "content": context[:12000]},
        ],
    })
    try:
        prompt = data["choices"][0]["message"]["content"].strip()
    except (IndexError, KeyError, TypeError, AttributeError) as exc:
        raise AIProviderError("The AI provider returned an invalid question response") from exc
    if not prompt:
        raise AIProviderError("The AI provider returned an empty question")
    return prompt
