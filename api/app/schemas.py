from datetime import datetime
from typing import Any

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    computed_field,
    field_validator,
    model_validator,
)


def uppercase_required_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("This field cannot be blank")
    return value.upper()


def uppercase_optional_text(value: str) -> str:
    return value.strip().upper()


class UserOut(BaseModel):
    id: str
    email: str
    first_name: str
    paternal_last_name: str
    maternal_last_name: str
    role: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

    @computed_field
    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.paternal_last_name} {self.maternal_last_name}".strip()


class AccountNamesIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    paternal_last_name: str = Field(min_length=1, max_length=100)
    maternal_last_name: str = Field(min_length=1, max_length=100)

    @field_validator("first_name", "paternal_last_name", "maternal_last_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return uppercase_required_name(value)


class RegisterIn(AccountNamesIn):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PasswordUpdate(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class StudentAllowlistCreate(BaseModel):
    email: EmailStr


class UserActiveUpdate(BaseModel):
    is_active: bool


class StudentAllowlistOut(BaseModel):
    id: str
    email: str
    created_at: datetime
    registered: bool
    student_name: str | None


class CourseCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    code: str = Field(default="", max_length=60)
    description: str = Field(default="", max_length=5000)
    credits: int = Field(default=0, ge=0, le=60)
    academic_period: str = Field(default="", max_length=80)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return uppercase_required_name(value)

    @field_validator("code", "academic_period")
    @classmethod
    def normalize_metadata(cls, value: str) -> str:
        return uppercase_optional_text(value)


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


class CourseSettingsOut(CourseSettingsIn):
    course_id: str

    model_config = ConfigDict(from_attributes=True)


class UnitIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    outcome: str = Field(default="", max_length=5000)
    position: int = Field(default=0, ge=0)
    weeks: str = Field(default="", max_length=80)
    hours: int = Field(default=0, ge=0, le=10000)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return uppercase_required_name(value)


class TopicIn(BaseModel):
    title: str = Field(min_length=2, max_length=240)
    position: int = Field(default=0, ge=0)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return uppercase_required_name(value)


class SkillIn(TopicIn):
    description: str = Field(default="", max_length=5000)


class TopicUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=240)
    position: int = Field(default=0, ge=0)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return uppercase_required_name(value)


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


class FolderUpdate(FolderCreate):
    pass


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


class UploadCompleteOut(MaterialOut):
    storage_confirmed: bool


class RubricCriterion(BaseModel):
    criterion: str = Field(min_length=1, max_length=500)


class QuestionCreate(BaseModel):
    prompt: str = Field(min_length=5, max_length=10000)
    unit_id: str | None = None
    skill_id: str | None = None
    question_type: str = Field(default="open", pattern="^(open|multiple_choice|numeric)$")
    options: list[str] | None = Field(default=None, max_length=8)
    answer_key: Any = None
    rubric: list[RubricCriterion] = Field(default_factory=list, max_length=30)
    irt_difficulty: float | None = Field(default=None, ge=-4, le=4)
    irt_discrimination: float | None = Field(default=None, ge=0.1, le=4)

    @model_validator(mode="after")
    def validate_answer_format(self) -> "QuestionCreate":
        if self.question_type == "multiple_choice":
            if not self.options or len(self.options) < 2:
                raise ValueError("Multiple-choice questions require at least two options")
            if not isinstance(self.answer_key, int) or not 0 <= self.answer_key < len(self.options):
                raise ValueError("The answer key must be the index of a valid option")
        elif self.question_type == "numeric":
            if not isinstance(self.answer_key, (int, float)) or isinstance(self.answer_key, bool):
                raise ValueError("Numeric questions require a numeric answer key")
            if self.options:
                raise ValueError("Numeric questions cannot have options")
        elif self.options or self.answer_key is not None:
            raise ValueError("Open questions cannot include options or an answer key")
        return self


class QuestionUpdate(QuestionCreate):
    pass


class SubmissionReview(BaseModel):
    final_score: int = Field(ge=0, le=20)
    teacher_comment: str = Field(default="", max_length=5000)


class CourseInviteCreate(BaseModel):
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=320)


class AssessmentCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=5000)
    kind: str = Field(default="practice", pattern="^(diagnostic|practice|quiz|transfer)$")

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return uppercase_required_name(value)


class AssessmentQuestionIn(BaseModel):
    question_id: str
    position: int = Field(default=0, ge=0)
    points: float = Field(default=1, gt=0, le=1000)


class StudentAnswerIn(BaseModel):
    response: Any
    confidence: int | None = Field(default=None, ge=0, le=2)


class ReviewRatingIn(BaseModel):
    rating: int = Field(ge=0, le=3)


class TutorMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class ReflectionCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)
    prompt: str = Field(default="", max_length=500)
