import httpx

from app.config import settings


class AIProviderError(RuntimeError):
    pass


async def request_ai(path: str, payload: dict) -> dict:
    if not settings.ai_configured:
        raise AIProviderError("AI provider is not configured")
    url = f"{settings.ai_request_base_url}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60)) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {settings.ai_request_api_key}"},
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


async def generate_tutor_reply(messages: list[dict], skill: str, sources: list[dict]) -> tuple[str, dict]:
    source_text = "\n\n".join(
        f"[{index + 1}] {source['material_name']} (p. {source['page_number'] or '—'}):\n{source['content']}"
        for index, source in enumerate(sources)
    )
    system = (
        "Eres un tutor universitario socrático que responde en español. Guía con una pregunta breve y una pista "
        "progresiva; no des la solución completa ni afirmes que el estudiante domina una habilidad. Pide que explique "
        "su razonamiento. Basa hechos del curso solamente en las fuentes recuperadas. Si no hay fuentes, dilo claramente "
        "y formula una pregunta general sin inventar contenido del curso. Cuando uses una fuente, añade [n] al final "
        "de la afirmación correspondiente."
    )
    if skill:
        system += f"\nHabilidad objetivo: {skill}."
    if source_text:
        system += f"\n\nFuentes recuperadas:\n{source_text[:10000]}"
    data = await request_ai("chat/completions", {
        "model": settings.ai_chat_model,
        "temperature": 0.4,
        "messages": [{"role": "system", "content": system}, *messages[-10:]],
    })
    try:
        reply = data["choices"][0]["message"]["content"].strip()
        usage = data.get("usage") or {}
    except (IndexError, KeyError, TypeError, AttributeError) as exc:
        raise AIProviderError("The AI provider returned an invalid tutor response") from exc
    if not reply:
        raise AIProviderError("The AI provider returned an empty tutor response")
    return reply, usage
