// Application layer barrel — use cases and port interfaces
// Does NOT export infrastructure types

// Ports
export { type AuthPort, type SessionRef, type AuthUserRef } from "./ports/auth-port";
export { type ProfilePort, type AvatarFile } from "./ports/profile-port";
export { type DeletionPort, type DeletionStatus } from "./ports/deletion-port";
export { type ExportPort, type ExportArtifact } from "./ports/export-port";

// Use cases
export { register } from "./register";
export { login } from "./login";
export { logout } from "./logout";
export { editProfile } from "./edit-profile";
export { setPreferences } from "./set-preferences";
export { requestPasswordRecovery } from "./request-password-recovery";
export { changePassword } from "./change-password";
export { changeEmail } from "./change-email";
export { getAccountDeletionStatus } from "./get-account-deletion-status";
export { requestAccountDeletion } from "./request-account-deletion";
export { cancelAccountDeletion } from "./cancel-account-deletion";
export { exportUserData } from "./export-user-data";
