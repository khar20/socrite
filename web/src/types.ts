export type User = {
  id: string
  email: string
  first_name: string
  paternal_last_name: string
  maternal_last_name: string
  full_name: string
  is_active: boolean
  role: 'admin' | 'teacher' | 'student'
}

export type PageResult<T> = { items: T[]; total: number; limit: number; offset: number }

export type Course = {
  id: string
  title: string
  code: string
  description: string
  credits: number
  academic_period: string
  status: 'draft' | 'active' | 'archived'
  created_at: string
  unit_count: number
  material_count: number
  student_count: number
  pending_reviews?: number
}

export type CurriculumUnit = {
  id: string
  course_id: string
  title: string
  outcome: string
  position: number
  weeks: string
  hours: number
  topics: { id: string; title: string; position: number }[]
  skills: { id: string; title: string; description: string; position: number }[]
}

export type Material = {
  id: string
  course_id: string
  folder_id: string | null
  unit_id: string | null
  name: string
  kind: 'file' | 'link'
  content_type: string
  size_bytes: number
  status: 'uploading' | 'queued' | 'processing' | 'ready' | 'failed' | 'deleting'
  error: string | null
  chunk_count: number
  created_at: string
}

export type Folder = { id: string; name: string; count: number }

export type DashboardData = {
  course_count: number
  material_count: number
  ready_material_count: number
  student_count: number
  pending_reviews: number
  courses: Pick<Course, 'id' | 'title' | 'code' | 'status'>[]
  recent_activity: { id: string; action: string; entity_type: string; created_at: string }[]
}

export type Question = {
  id: string
  prompt: string
  unit_id: string | null
  skill_id?: string | null
  question_type: 'open' | 'multiple_choice' | 'numeric'
  options?: string[] | null
  answer_key?: unknown
  rubric: { criterion: string }[]
  irt_difficulty?: number | null
  irt_discrimination?: number | null
  status: 'draft' | 'published' | 'archived'
  created_at?: string
}

export type Assessment = {
  id: string
  title: string
  description: string
  kind: 'diagnostic' | 'practice' | 'quiz' | 'transfer'
  status: 'draft' | 'published' | 'archived'
  question_ids: string[]
  created_at?: string
}

export type Submission = {
  id: string
  student_name: string
  student_email: string
  response: string
  suggested_score: number | null
  suggested_feedback?: string
  final_score: number | null
  teacher_comment: string | null
  status: 'pending' | 'reviewed'
  created_at: string
}

export type Configuration = {
  database_configured: boolean
  ai_configured: boolean
  ai_provider: string | null
  ai_cost_rates_configured: boolean
  chat_model: string | null
  embedding_model: string | null
  storage_configured: boolean
  max_upload_mb: number
}
