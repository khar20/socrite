import json

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


async def evaluate_open_response(prompt: str, response: str, rubric: list[dict]) -> tuple[int, str]:
    criteria = "\n".join(f"- {item['criterion']}" for item in rubric)
    data = await request_ai("chat/completions", {
        "model": settings.ai_chat_model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": (
                "Evalúa una respuesta universitaria usando solamente el enunciado y la rúbrica. "
                "Devuelve JSON con score (entero 0-20), feedback (breve y accionable) y "
                "conceptual_errors (lista breve). No infieras dominio a largo plazo: esto es solo una "
                "sugerencia para que el docente la revise."
            )},
            {"role": "user", "content": (
                f"Enunciado:\n{prompt[:8000]}\n\nCriterios:\n{criteria[:6000]}"
                f"\n\nRespuesta del estudiante:\n{response[:12000]}"
            )},
        ],
    })
    try:
        content = data["choices"][0]["message"]["content"]
        result = json.loads(content)
        score = result["score"]
        feedback = result["feedback"]
        errors = result.get("conceptual_errors", [])
        if (not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= 20
                or not isinstance(feedback, str) or not isinstance(errors, list)):
            raise ValueError("Invalid evaluation values")
    except (IndexError, KeyError, TypeError, ValueError) as exc:
        raise AIProviderError("The AI provider returned an invalid response evaluation") from exc
    suggestions = [str(error).strip()[:500] for error in errors[:5] if str(error).strip()]
    if suggestions:
        feedback = f"{feedback.strip()}\n\nPosibles errores conceptuales: " + "; ".join(suggestions)
    return score, feedback[:2500]


async def generate_tutor_reply(messages: list[dict], skill: str, sources: list[dict]) -> str:
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
    except (IndexError, KeyError, TypeError, AttributeError) as exc:
        raise AIProviderError("The AI provider returned an invalid tutor response") from exc
    if not reply:
        raise AIProviderError("The AI provider returned an empty tutor response")
    return reply
