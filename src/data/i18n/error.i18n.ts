import type { TranslationDict } from './translate';

/**
 * Error messages keyed by a stable code. Services throw the code (via
 * `ERROR_MESSAGES.*`); `HttpExceptionFilter` localizes it using `request.language`.
 */
export const ERROR_TRANSLATIONS = {
  // Auth
  EMAIL_EXISTS: { vi: 'Email đã tồn tại', en: 'Email already exists' },
  USERNAME_EXISTS: { vi: 'Tên đăng nhập đã tồn tại', en: 'Username already exists' },
  USER_NOT_FOUND: { vi: 'Không tìm thấy người dùng', en: 'User not found' },
  INVALID_PASSWORD: { vi: 'Mật khẩu không đúng', en: 'Invalid password' },
  INVALID_RESET_PASSWORD_TOKEN: {
    vi: 'Mã đặt lại mật khẩu không hợp lệ',
    en: 'Invalid reset password token',
  },
  USER_NOT_ACTIVE: { vi: 'Tài khoản chưa được kích hoạt', en: 'User is not active' },
  FAILED_TO_RESET_PASSWORD: { vi: 'Đặt lại mật khẩu thất bại', en: 'Failed to reset password' },
  FAILED_TO_UPDATE_PASSWORD: { vi: 'Cập nhật mật khẩu thất bại', en: 'Failed to update password' },
  INVALID_USER_ID: { vi: 'ID người dùng không hợp lệ', en: 'Invalid user ID' },
  USER_ALREADY_LOGGED_OUT: { vi: 'Người dùng đã đăng xuất', en: 'User already logged out' },
  INVALID_TOKEN_PAYLOAD: { vi: 'Nội dung token không hợp lệ', en: 'Invalid token payload' },
  INVALID_TOKEN_TYPE: { vi: 'Loại token không hợp lệ', en: 'Invalid token type' },
  INVALID_OR_EXPIRED_REFRESH_TOKEN: {
    vi: 'Refresh token không hợp lệ hoặc đã hết hạn',
    en: 'Invalid or expired refresh token',
  },
  USER_NO_LONGER_EXISTS: { vi: 'Người dùng không còn tồn tại', en: 'User no longer exists' },
  FAILED_TO_CREATE_USER: { vi: 'Tạo người dùng thất bại', en: 'Failed to create user' },

  // Auth validation (Zod schema messages)
  AUTH_EMAIL_REQUIRED: { vi: 'Vui lòng nhập email', en: 'Email is required' },
  AUTH_EMAIL_INVALID: { vi: 'Email không hợp lệ', en: 'Invalid email address' },
  AUTH_USERNAME_REQUIRED: { vi: 'Vui lòng nhập tên đăng nhập', en: 'Username is required' },
  AUTH_PASSWORD_REQUIRED: { vi: 'Vui lòng nhập mật khẩu', en: 'Password is required' },
  AUTH_PASSWORD_MIN: {
    vi: 'Mật khẩu phải có ít nhất 6 ký tự',
    en: 'Password must be at least 6 characters long',
  },
  AUTH_PASSWORD_MAX: {
    vi: 'Mật khẩu không được quá 25 ký tự',
    en: 'Password must be less than 25 characters long',
  },
  AUTH_PASSWORD_LOWERCASE: {
    vi: 'Mật khẩu phải có ít nhất một chữ thường (a-z)',
    en: 'Password must include at least one lowercase letter (a-z)',
  },
  AUTH_PASSWORD_UPPERCASE: {
    vi: 'Mật khẩu phải có ít nhất một chữ hoa (A-Z)',
    en: 'Password must include at least one uppercase letter (A-Z)',
  },
  AUTH_PASSWORD_DIGIT: {
    vi: 'Mật khẩu phải có ít nhất một chữ số (0-9)',
    en: 'Password must include at least one digit (0-9)',
  },
  AUTH_PASSWORD_SPECIAL: {
    vi: 'Mật khẩu phải có ít nhất một ký tự đặc biệt',
    en: 'Password must include at least one special character (any symbol that is not a letter or digit)',
  },
  AUTH_FIRST_NAME_REQUIRED: { vi: 'Vui lòng nhập tên', en: 'First name is required' },
  AUTH_FIRST_NAME_MAX: {
    vi: 'Tên không được quá 25 ký tự',
    en: 'First name must be less than 25 characters long',
  },
  AUTH_LAST_NAME_REQUIRED: { vi: 'Vui lòng nhập họ', en: 'Last name is required' },
  AUTH_LAST_NAME_MAX: {
    vi: 'Họ không được quá 25 ký tự',
    en: 'Last name must be less than 25 characters long',
  },
  AUTH_REFRESH_TOKEN_REQUIRED: {
    vi: 'Thiếu refresh token',
    en: 'Refresh token is required',
  },
  AUTH_RESET_TOKEN_REQUIRED: {
    vi: 'Thiếu mã đặt lại mật khẩu',
    en: 'Reset password token is required',
  },
  AUTH_RESET_TOKEN_INVALID: {
    vi: 'Mã đặt lại mật khẩu không hợp lệ',
    en: 'Invalid reset password token',
  },
  AUTH_CONFIRM_PASSWORD_REQUIRED: {
    vi: 'Vui lòng nhập lại mật khẩu',
    en: 'Confirm password is required',
  },
  AUTH_CONFIRM_PASSWORD_MIN: {
    vi: 'Mật khẩu xác nhận phải có ít nhất 6 ký tự',
    en: 'Confirm password must be at least 6 characters long',
  },
  AUTH_CONFIRM_PASSWORD_MAX: {
    vi: 'Mật khẩu xác nhận không được quá 25 ký tự',
    en: 'Confirm password must be less than 25 characters long',
  },
  AUTH_CONFIRM_PASSWORD_MISMATCH: {
    vi: 'Mật khẩu xác nhận không khớp với mật khẩu',
    en: 'Confirm password must be the same as password',
  },
  AUTH_USER_CODE_REQUIRED: { vi: 'Vui lòng nhập mã người dùng', en: 'User code is required' },
  AUTH_USER_CODE_LENGTH: {
    vi: 'Mã người dùng phải gồm 6 ký tự',
    en: 'User code must be 6 characters',
  },

  // UUID
  USER_ID_MUST_BE_UUID: { vi: 'ID người dùng phải là UUID', en: 'User Id must be uuid' },
  CLASS_ID_MUST_BE_UUID: { vi: 'ID lớp học phải là UUID', en: 'Class Id must be uuid' },
  SCHEDULE_ID_MUST_BE_UUID: { vi: 'ID lịch học phải là UUID', en: 'Schedule Id must be uuid' },
  SESSION_ID_MUST_BE_UUID: { vi: 'ID buổi học phải là UUID', en: 'Session Id must be uuid' },
  CURRICULUM_ID_MUST_BE_UUID: {
    vi: 'curriculumId phải là UUID hợp lệ',
    en: 'curriculumId must be a valid UUID',
  },
  CHAPTER_ID_MUST_BE_UUID: {
    vi: 'chapterId phải là UUID hợp lệ',
    en: 'chapterId must be a valid UUID',
  },
  LESSON_ID_INVALID: { vi: 'ID bài học không hợp lệ', en: 'Invalid lesson id' },
  CHAPTER_ID_INVALID: { vi: 'ID chương không hợp lệ', en: 'Invalid chapter id' },
  CURRICULUM_ID_INVALID: { vi: 'ID chương trình học không hợp lệ', en: 'Invalid curriculum id' },
  TUTOR_ID_MUST_BE_UUID: { vi: 'ID gia sư phải là UUID', en: 'Tutor Id must be uuid' },
  ID_MUST_BE_UUID: { vi: 'ID phải là UUID', en: 'id must be uuid' },
  TUTOR_ID_INVALID: { vi: 'tutorId phải là UUID', en: 'tutorId must be uuid' },
  CLASS_ID_INVALID: { vi: 'classId phải là UUID', en: 'classId must be uuid' },

  // Class
  CLASS_NAME_EXISTS: { vi: 'Tên lớp học đã tồn tại', en: 'Class name already exists' },
  CLASS_CODE_EXISTS: { vi: 'Mã lớp học đã tồn tại', en: 'Class code already exists' },
  CLASS_NOT_FOUND: { vi: 'Không tìm thấy lớp học', en: 'Class not found' },
  USER_NOT_EXIST: { vi: 'Người dùng không tồn tại', en: 'User does not exist' },
  TUTOR_NOT_FOUND: { vi: 'Không tìm thấy gia sư', en: 'Tutor not found' },
  STUDENT_NOT_FOUND: { vi: 'Không tìm thấy học sinh', en: 'Student not found' },
  USER_NOT_A_STUDENT: { vi: 'Người dùng không phải học sinh', en: 'User is not a student' },
  UNABLE_TO_GENERATE_UNIQUE_CODE: {
    vi: 'Không tạo được mã duy nhất, vui lòng thử lại',
    en: 'Unable to generate unique code, please try again',
  },

  // Curriculum
  CURRICULUM_NOT_FOUND: { vi: 'Không tìm thấy chương trình học', en: 'Curriculum not found' },

  // Chapter
  CHAPTER_NOT_FOUND: { vi: 'Không tìm thấy chương', en: 'Chapter not found' },

  // Lesson
  LESSON_NOT_FOUND: { vi: 'Không tìm thấy bài học', en: 'Lesson not found' },
  UPLOAD_THEORY_FAILED: { vi: 'Tải lên lý thuyết thất bại', en: 'Upload theory failed' },
  UPLOAD_EXERCISES_FAILED: { vi: 'Tải lên bài tập thất bại', en: 'Upload exercises failed' },

  // Exercise
  EXERCISE_NOT_FOUND: { vi: 'Không tìm thấy bài tập', en: 'Exercise not found' },
  EXERCISE_ALREADY_SUBMITTED: {
    vi: 'Bài tập đã được nộp cho buổi học này',
    en: 'Exercise already submitted for this session',
  },
  EXERCISE_ALREADY_GRADED: {
    vi: 'Bài tập đã được chấm — không thể nộp lại',
    en: 'Exercise already graded — cannot re-submit',
  },
  EXERCISE_SUBMIT_NOT_ALLOWED: {
    vi: 'Bạn không thể nộp bài tập này',
    en: 'You cannot submit this exercise',
  },
  EXERCISE_RE_SUBMIT_NOT_ALLOWED: {
    vi: 'Bạn chỉ có thể nộp lại bài tập của chính mình',
    en: 'You can only re-submit your own exercise',
  },
  EXERCISE_GRADE_NOT_ALLOWED: {
    vi: 'Chỉ gia sư phụ trách mới được chấm bài tập này',
    en: 'Only the assigned tutor can grade this exercise',
  },

  // Session
  SESSION_NOT_FOUND: { vi: 'Không tìm thấy buổi học', en: 'Session not found' },

  // Attendance
  ATTENDANCE_MARK_NOT_ALLOWED: {
    vi: 'Chỉ gia sư phụ trách mới được điểm danh buổi học này',
    en: 'Only the assigned tutor can mark attendance for this session',
  },

  // Schedule
  SCHEDULE_NOT_FOUND: { vi: 'Không tìm thấy lịch học', en: 'Schedule not found' },

  // Notification
  NOTIFICATION_NOT_FOUND: { vi: 'Không tìm thấy thông báo', en: 'Notification not found' },
  USER_ID_NOT_VALID: { vi: 'userId không hợp lệ', en: 'userId is not valid' },
  CLASS_ID_NOT_VALID: { vi: 'classId không hợp lệ', en: 'classId is not valid' },
  STUDENT_ID_NOT_VALID: { vi: 'studentId không hợp lệ', en: 'studentId is not valid' },

  // Test scenario
  TEST_SCENARIO_NOT_FOUND: { vi: 'Không tìm thấy kịch bản test', en: 'Test scenario not found' },

  // Tuition
  TUITION_RECORD_NOT_FOUND: { vi: 'Không tìm thấy hồ sơ học phí', en: 'Tuition record not found' },

  // User
  UNSUPPORTED_FIELD: { vi: 'Trường không được hỗ trợ', en: 'Unsupported field' },
  GRADE_NOT_FOUND: { vi: 'Không tìm thấy khối lớp', en: 'Grade not found' },
  INVALID_GRADE_IDS: {
    vi: 'Một hoặc nhiều ID khối lớp không hợp lệ',
    en: 'One or more grade IDs are invalid',
  },
  CURRENT_PASSWORD_INCORRECT: {
    vi: 'Mật khẩu hiện tại không đúng',
    en: 'Current password is incorrect',
  },
  UNABLE_TO_GENERATE_USERNAME: {
    vi: 'Không tạo được tên đăng nhập duy nhất',
    en: 'Cannot generate unique username',
  },
  UNABLE_TO_GENERATE_USER_CODE: {
    vi: 'Không tạo được mã người dùng duy nhất sau 5 lần thử',
    en: 'Cannot generate a unique user code after 5 attempts',
  },
  UPDATE_USER_AVATAR_FAILED: {
    vi: 'Thay đổi ảnh đại diện thất bại ...',
    en: 'Update user avatar failed ...',
  },

  // Admin
  ADMIN_INVALID_ID: { vi: 'ID không hợp lệ', en: 'Invalid id' },
  PARENT_NOT_FOUND: { vi: 'Không tìm thấy phụ huynh', en: 'Parent not found' },
  STUDENT_CANNOT_UPDATE_NAME: {
    vi: 'Học sinh không được tự thay đổi họ tên',
    en: 'Students are not allowed to update their own first/last name',
  },

  // Upload
  KEY_QUERY_PARAM_REQUIRED: {
    vi: 'Thiếu tham số truy vấn "key"',
    en: 'key query param is required',
  },
  FILE_NOT_FOUND: { vi: 'Không tìm thấy tệp', en: 'File not found' },
  CLOUDFLARE_R2_NOT_CONFIGURED: {
    vi: 'Cloudflare R2 chưa được cấu hình',
    en: 'Cloudflare R2 not configured',
  },
  BAD_GATEWAY: {
    vi: 'Thiếu endpoint|accessKeyId|secretAccessKey',
    en: 'endpoint|accessKeyId|secretAccessKey not found',
  },

  // Auth guards
  CHECK_ROLE_USER_FAILED: {
    vi: 'Kiểm tra vai trò người dùng thất bại',
    en: 'Check role user failed',
  },
  UNAUTHORIZED: { vi: 'Chưa xác thực', en: 'Unauthorized' },
  ADMIN_ROLE_REQUIRED: { vi: 'Yêu cầu quyền quản trị', en: 'Admin role required' },
  PERMISSION_DENIED: {
    vi: 'Bạn không có quyền truy cập tài nguyên này',
    en: 'You do not have permission to access this resource',
  },

  // Student
  STUDENT_CODE_EXISTS: { vi: 'Mã học sinh đã tồn tại', en: 'Student code already exists' },

  // Generic
  VALIDATION_FAILED: { vi: 'Dữ liệu không hợp lệ', en: 'Validation failed' },

  // Mail
  MAIL_NOT_CONFIGURED: { vi: 'Email chưa được cấu hình', en: 'Mail is not configured' },
  MAIL_FROM_NOT_SET: { vi: 'MAIL_FROM chưa được thiết lập', en: 'MAIL_FROM is not set' },

  // Google
  GOOGLE_NO_PUBLIC_EMAIL: {
    vi: 'Tài khoản Google không có email công khai',
    en: 'Google account has no public email',
  },

  // Rate limit
  TOO_MANY_REQUESTS: {
    vi: 'Bạn đã gửi quá nhiều yêu cầu, vui lòng thử lại sau',
    en: 'Too many requests, please try again later',
  },

  // Hasher
  FAILED_TO_HASH_DATA: { vi: 'Băm dữ liệu thất bại', en: 'Failed to hash data' },
  FAILED_TO_VERIFY_DATA: { vi: 'Xác minh dữ liệu thất bại', en: 'Failed to verify data' },
} as const satisfies TranslationDict;
