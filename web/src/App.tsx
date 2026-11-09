import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth-context'
import { AppLayout, PageLoading } from './components/layout'
import { AccessDenied, LoginPage } from './pages/Login'
import { DashboardPage } from './pages/Dashboard'
import { CoursesPage } from './pages/Courses'
import { CourseOverviewPage } from './pages/CourseOverview'
import { CurriculumPage } from './pages/Curriculum'
import { MaterialsPage } from './pages/Materials'
import { StudentsPage, ReviewsPage } from './pages/TeacherOperations'
import { QuestionsPage } from './pages/Questions'
import { SettingsPage } from './pages/Settings'
import { ActivityPage } from './pages/Activity'

function ProtectedLayout() {
  const { profile, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== 'teacher') return <AccessDenied />
  return <AppLayout />
}

export default function App() {
  const { profile } = useAuth()
  return <Routes>
    <Route path="/login" element={profile ? <Navigate to={profile.role === 'teacher' ? '/teacher' : '/access-denied'} replace /> : <LoginPage />} />
    <Route path="/access-denied" element={<AccessDenied />} />
    <Route path="/teacher" element={<ProtectedLayout />}>
      <Route index element={<DashboardPage />} />
      <Route path="courses" element={<CoursesPage />} />
      <Route path="courses/:courseId" element={<CourseOverviewPage />} />
      <Route path="courses/:courseId/curriculum" element={<CurriculumPage />} />
      <Route path="courses/:courseId/materials" element={<MaterialsPage />} />
      <Route path="courses/:courseId/students" element={<StudentsPage />} />
      <Route path="courses/:courseId/reviews" element={<ReviewsPage />} />
      <Route path="courses/:courseId/questions" element={<QuestionsPage />} />
      <Route path="courses/:courseId/settings" element={<SettingsPage />} />
      <Route path="courses/:courseId/activity" element={<ActivityPage />} />
      <Route path="activity" element={<ActivityPage />} />
    </Route>
    <Route path="*" element={<Navigate to={profile ? (profile.role === 'teacher' ? '/teacher' : '/access-denied') : '/login'} replace />} />
  </Routes>
}
