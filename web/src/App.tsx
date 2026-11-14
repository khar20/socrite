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
import { StudentDashboardPage, StudentCoursePage, StudentMaterialsPage,
  StudentAttemptPage, StudentProgressPage,
  StudentTutorPage, StudentFeedbackPage } from './pages/Student'
import { StudentHomePage } from './pages/student/Home'
import { StudentPathPage } from './pages/student/Path'
import { StudentPracticePage } from './pages/student/Practice'
import { StudentReviewPage } from './pages/student/Review'
import { StudentProblemsPage } from './pages/student/Problems'
import { AssessmentsPage } from './pages/Assessments'
import { AccountPage } from './pages/Account'
import { StudentAllowlistPage } from './pages/StudentAllowlist'
import { AdminUsersPage } from './pages/AdminUsers'
import { CourseAnalyticsPage } from './pages/CourseAnalytics'
import { ConsentPage } from './pages/Consent'

function ProtectedLayout({ role }: { role: 'teacher' | 'student' }) {
  const { profile, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!profile) return <Navigate to="/login" replace />
  if (role === 'teacher' ? !['admin', 'teacher'].includes(profile.role) : profile.role !== role) return <AccessDenied />
  return <AppLayout mode={role} />
}

export default function App() {
  const { profile } = useAuth()
  return <Routes>
    <Route path="/consentimiento-informado" element={<ConsentPage />} />
    <Route path="/login" element={profile ? <Navigate to={profile.role === 'student' ? '/student' : '/teacher'} replace /> : <LoginPage />} />
    <Route path="/access-denied" element={<AccessDenied />} />
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
      <Route path="courses/:courseId" element={<StudentHomePage />} />
      <Route path="courses/:courseId/overview" element={<StudentCoursePage />} />
      <Route path="courses/:courseId/path" element={<StudentPathPage />} />
      <Route path="courses/:courseId/curriculum" element={<Navigate to="../path" replace />} />
      <Route path="courses/:courseId/materials" element={<StudentMaterialsPage />} />
      <Route path="courses/:courseId/practice" element={<StudentPracticePage />} />
      <Route path="courses/:courseId/review" element={<StudentReviewPage />} />
      <Route path="courses/:courseId/problems" element={<StudentProblemsPage />} />
      <Route path="courses/:courseId/assessments" element={<Navigate to="../practice" replace />} />
      <Route path="courses/:courseId/tutor" element={<StudentTutorPage />} />
      <Route path="courses/:courseId/feedback" element={<StudentFeedbackPage />} />
      <Route path="courses/:courseId/progress" element={<StudentProgressPage />} />
      <Route path="attempts/:attemptId" element={<StudentAttemptPage />} />
      <Route path="account" element={<AccountPage />} />
    </Route>
    <Route path="*" element={<Navigate to={profile ? (profile.role === 'teacher' ? '/teacher' : '/student') : '/login'} replace />} />
  </Routes>
}
