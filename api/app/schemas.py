from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class ProfileOut(BaseModel):
    id: str
    email: str
    name: str
    role: str

    model_config = ConfigDict(from_attributes=True)


class CourseCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    code: str = Field(default="", max_length=60)
    description: str = Field(default="", max_length=5000)
    credits: int = Field(default=0, ge=0, le=60)
    academic_period: str = Field(default="", max_length=80)


class CourseUpdate(CourseCreate):
    status: str = Field(default="draft", pattern="^(draft|active|archived)$")


class CourseOut(CourseCreate):
    id: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CourseSettingsIn(BaseModel):
    socratic_mode: bool = True
    human_review_required: bool = True
    attempts_before_solution: int = Field(default=3, ge=1, le=10)
    monthly_ai_budget: int = Field(default=150, ge=0, le=100000)


class CourseSettingsOut(CourseSettingsIn):
    course_id: str

    model_config = ConfigDict(from_attributes=True)


class UnitIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    outcome: str = Field(default="", max_length=5000)
    position: int = Field(default=0, ge=0)
    weeks: str = Field(default="", max_length=80)
    hours: int = Field(default=0, ge=0, le=10000)


class TopicIn(BaseModel):
    title: str = Field(min_length=2, max_length=240)
    position: int = Field(default=0, ge=0)


class SkillIn(TopicIn):
    description: str = Field(default="", max_length=5000)


class TopicUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=240)
    position: int = Field(default=0, ge=0)


class SkillUpdate(TopicUpdate):
    description: str = Field(default="", max_length=5000)


class UnitOut(UnitIn):
    id: str
    course_id: str
    topics: list[dict] = []
    skills: list[dict] = []

    model_config = ConfigDict(from_attributes=True)


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class UploadRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=180)
    size_bytes: int = Field(gt=0)
    folder_id: str | None = None
    unit_id: str | None = None


class LinkCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    url: HttpUrl
    folder_id: str | None = None
    unit_id: str | None = None


class MaterialUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    folder_id: str | None = None
    unit_id: str | None = None


class MaterialOut(BaseModel):
    id: str
    course_id: str
    folder_id: str | None
    unit_id: str | None
    name: str
    kind: str
    content_type: str
    size_bytes: int
    status: str
    error: str | None
    chunk_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class QuestionCreate(BaseModel):
    prompt: str = Field(min_length=5, max_length=10000)
    unit_id: str | None = None
    question_type: str = Field(default="open", pattern="^open$")
    rubric: list[dict] = Field(default_factory=list)


class SubmissionReview(BaseModel):
    final_score: int = Field(ge=0, le=20)
    teacher_comment: str = Field(default="", max_length=5000)
