export type StudentCourse = {
  id: string
  title: string
  code: string
  description: string
  status: 'draft' | 'active' | 'archived'
  credits: number
  academic_period: string
}

export type StudentActivity = {
  id: string
  title: string
  kind: string
  question_count: number
  predicted_success: number
}

export type NextActivity = {
  skill: { id: string; title: string; unit: string; probability: number | null; observations: number; due_at: string | null } | null
  activity: StudentActivity | null
  reason: string
}

export type HomeSummary = {
  average_mastery: number | null
  mastered_skills: number
  total_skills: number
  due_reviews: number
  streak_days: number
  evidence_count: number
}

export type DueSkill = {
  skill_id: string
  skill: string
  unit: string
  unit_id: string
  unit_position: number
  probability: number | null
  due_at: string
  interval_days: number
  repetitions: number
}

export type HomeUnit = {
  id: string
  title: string
  position: number
  skill_count: number
  mastery: number | null
}

export type RecentActivity = {
  skill: string
  is_correct: boolean
  is_transfer: boolean
  created_at: string
}

export type HomeData = {
  course: StudentCourse
  summary: HomeSummary
  next_activity: NextActivity
  due_skills: DueSkill[]
  units: HomeUnit[]
  recent_activity: RecentActivity[]
}

export type PathSkill = {
  id: string
  title: string
  description: string
  probability: number | null
  observations: number
  due_at: string | null
}

export type PathMaterial = {
  id: string
  name: string
  kind: 'file' | 'link'
  status: string
  chunk_count: number
}

export type PathUnit = {
  id: string
  title: string
  outcome: string
  position: number
  hours: number
  mastery: number | null
  excerpt: string | null
  topics: { id: string; title: string }[]
  skills: PathSkill[]
  materials: PathMaterial[]
  has_indexed_material: boolean
}

export type PathData = {
  course: { id: string; title: string; code: string }
  units: PathUnit[]
}

export type PracticeAssessment = {
  id: string
  title: string
  description: string
  kind: 'diagnostic' | 'practice' | 'quiz' | 'transfer' | string
  question_count: number
  skills: { id: string; title: string }[]
}
