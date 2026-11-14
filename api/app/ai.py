import asyncio
import base64
import json
import logging

import httpx
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)


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


async def extract_image_text(image_bytes: bytes) -> str:
    try:
        from app.services.ingestion import optimize_image

        optimized = await asyncio.to_thread(optimize_image, image_bytes)
    except (Image.DecompressionBombError, OSError, ValueError) as exc:
        logger.warning("Skipping an image that could not be prepared for OCR: %s", type(exc).__name__)
        return ""

    image_url = f"data:image/jpeg;base64,{base64.b64encode(optimized).decode('ascii')}"
    data = await request_ai("chat/completions", {
        "model": settings.ai_vision_model,
        "temperature": 0,
        "max_tokens": 4096,
        "messages": [
            {"role": "system", "content": (
                "Eres un sistema OCR. Transcribe solamente el texto legible que aparece en la imagen, "
                "con prioridad en español y respetando acentos y signos. Devuelve únicamente la transcripción "
                "en Markdown, conservando títulos, párrafos, listas y tablas cuando sean visibles. "
                "No describas imágenes, diagramas ni gráficos. No añadas pies de foto, explicaciones, "
                "interpretaciones, resúmenes ni texto inferido. Omite lo ilegible en vez de adivinar. "
                "Si no hay texto legible, devuelve una cadena vacía."
            )},
            {"role": "user", "content": [
                {"type": "text", "text": "Transcribe solo el texto visible en esta imagen."},
                {"type": "image_url", "image_url": {"url": image_url, "detail": "high"}},
            ]},
        ],
    })
    try:
        content = data["choices"][0]["message"]["content"]
    except (IndexError, KeyError, TypeError) as exc:
        raise AIProviderError("The vision model returned an invalid OCR response") from exc

    if isinstance(content, list):
        content = "\n".join(
            part["text"] for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    if not isinstance(content, str):
        raise AIProviderError("The vision model returned an invalid OCR response")
    lines = content.strip().splitlines()
    if lines and lines[0].strip().startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


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


async def generate_practice_assessment(
    course_context: str,
    theme: str,
    sources: str,
    question_count: int,
    question_types: list[str],
    focus: str = "",
) -> dict:
    type_guidance = []
    if "multiple_choice" in question_types:
        type_guidance.append(
            "multiple_choice: cuatro opciones plausibles y una sola correcta; "
            "answer_key es el índice entero de la opción correcta (empieza en 0); rubric vacía."
        )
    if "open" in question_types:
        type_guidance.append(
            "open: sin opciones ni answer_key; incluye una rúbrica de 2 a 4 criterios observables."
        )
    system = (
        "Eres un docente universitario que diseña evaluaciones de práctica en español. "
        "Trabaja exclusivamente con las FUENTES numeradas que recibirás. No uses conocimiento externo, "
        "suposiciones ni contenido inventado. Si una pregunta no puede sustentarse en las fuentes, no la incluyas. "
        "No inventes cifras, dosis, tiempos, porcentajes, nombres ni procedimientos que no aparezcan textualmente. "
        "Cada pregunta debe ser autónoma y comprensible sin leer las fuentes. "
        "Devuelve únicamente un objeto JSON válido, sin texto adicional ni bloques de código."
    )
    user = (
        f"CONTEXTO DEL CURSO:\n{course_context[:6000]}\n\n"
        f"TEMA DE LA PRÁCTICA: {theme}\n"
        f"ENFOQUE ADICIONAL: {focus.strip() or 'ninguno'}\n"
        f"CANTIDAD DE PREGUNTAS: {question_count}\n"
        f"TIPOS PERMITIDOS: {', '.join(question_types)}\n\n"
        f"REGLAS DE FORMATO:\n- {'; '.join(type_guidance)}\n"
        "- Cada pregunta debe incluir source_ids con los identificadores [S1], [S2], etc. que la sustentan.\n"
        "- Usa solamente identificadores de fuente incluidos en este mensaje.\n"
        "- No menciones los identificadores dentro del enunciado.\n"
        "- Devuelve exactamente esta estructura JSON: "
        '{"title": "...", "description": "...", "instructions": "...", '
        '"questions": [{"prompt": "...", "question_type": "multiple_choice|open", '
        '"options": ["..."], "answer_key": 0, "rubric": ["..."], "source_ids": ["S1"]}]}\n\n'
        f"FUENTES:\n{sources}"
    )
    data = await request_ai("chat/completions", {
        "model": settings.ai_chat_model,
        "temperature": 0.2,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    })
    try:
        content = data["choices"][0]["message"]["content"]
    except (IndexError, KeyError, TypeError) as exc:
        raise AIProviderError("The AI provider returned an invalid assessment response") from exc
    if not isinstance(content, str):
        raise AIProviderError("The AI provider returned an invalid assessment response")
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    try:
        result = json.loads(text.strip())
    except ValueError as exc:
        raise AIProviderError("The AI provider returned malformed assessment content") from exc
    if not isinstance(result, dict):
        raise AIProviderError("The AI provider returned an invalid assessment response")
    return result


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
