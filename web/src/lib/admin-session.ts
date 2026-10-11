export function redirectAdminOnAuthFailure(response: Response) {
  if (response.status !== 401 && response.status !== 403) return false;
  window.location.replace("/admin/login");
  return true;
}
