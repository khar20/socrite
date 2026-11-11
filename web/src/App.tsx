import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
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
import { StudentDashboardPage, StudentCoursePage, StudentCurriculumPage, StudentMaterialsPage,
  StudentAssessmentsPage, StudentAttemptPage, StudentProgressPage, StudentJoinPage,
  StudentTutorPage, StudentFeedbackPage } from './pages/Student'
import { AssessmentsPage } from './pages/Assessments'
import { AccountPage } from './pages/Account'
import { StudentAllowlistPage } from './pages/StudentAllowlist'
import { AdminUsersPage } from './pages/AdminUsers'
import { CourseAnalyticsPage } from './pages/CourseAnalytics'

function ProtectedLayout({ role }: { role: 'teacher' | 'student' }) {
  const { profile, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!profile) return <Navigate to="/login" replace />
  if (role === 'teacher' ? !['admin', 'teacher'].includes(profile.role) : profile.role !== role) return <AccessDenied />
  return <AppLayout mode={role} />
}

function InvitationRoute() {
  const { profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoading />
  if (!profile) return <Navigate to="/login" state={{ returnTo: location.pathname }} replace />
  if (profile.role !== 'student') return <AccessDenied />
  return <StudentJoinPage />
}

export default function App() {
  const { profile } = useAuth()
  return <Routes>
    <Route path="/login" element={profile ? <Navigate to={profile.role === 'student' ? '/student' : '/teacher'} replace /> : <LoginPage />} />
    <Route path="/access-denied" element={<AccessDenied />} />
    <Route path="/join/:token" element={<InvitationRoute />} />
    <Route path="/teacher" element={<ProtectedLayout role="teacher" />}>
      <Route index element={<DashboardPage />} />
      <Route path="courses" element={<CoursesPage />} />
      <Route path="courses/:courseId" element={<CourseOverviewPage />} />
      <Route path="courses/:courseId/curriculum" element={<CurriculumPage />} />
      <Route path="courses/:courseId/materials" element={<MaterialsPage />} />
      <Route path="courses/:courseId/students" element={<StudentsPage />} />
      <Route path="courses/:courseId/analytics" element={<CourseAnalyticsPage />} />
      <Route path="courses/:courseId/reviews" element={<ReviewsPage />} />
      <Route path="courses/:courseId/questions" element={<QuestionsPage />} />
      <Route path="courses/:courseId/assessments" element={<AssessmentsPage />} />
      <Route path="courses/:courseId/settings" element={<SettingsPage />} />
      <Route path="courses/:courseId/activity" element={<ActivityPage />} />
      <Route path="activity" element={<ActivityPage />} />
      <Route path="account" element={<AccountPage />} />
      <Route path="admin/students" element={profile?.role === 'admin' ? <StudentAllowlistPage /> : <AccessDenied />} />
      <Route path="admin/users" element={profile?.role === 'admin' ? <AdminUsersPage /> : <AccessDenied />} />
    </Route>
    <Route path="/student" element={<ProtectedLayout role="student" />}>
      <Route index element={<StudentDashboardPage />} />
      <Route path="courses" element={<StudentDashboardPage />} />
      <Route path="courses/:courseId" element={<StudentCoursePage />} />
      <Route path="courses/:courseId/curriculum" element={<StudentCurriculumPage />} />
      <Route path="courses/:courseId/materials" element={<StudentMaterialsPage />} />
      <Route path="courses/:courseId/assessments" element={<StudentAssessmentsPage />} />
      <Route path="courses/:courseId/tutor" element={<StudentTutorPage />} />
      <Route path="courses/:courseId/feedback" element={<StudentFeedbackPage />} />
      <Route path="courses/:courseId/progress" element={<StudentProgressPage />} />
      <Route path="attempts/:attemptId" element={<StudentAttemptPage />} />
      <Route path="account" element={<AccountPage />} />
    </Route>
    <Route path="*" element={<Navigate to={profile ? (profile.role === 'teacher' ? '/teacher' : '/student') : '/login'} replace />} />
  </Routes>
}
