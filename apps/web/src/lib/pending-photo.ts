// Hands a captured photo from the hero camera button to the listing form
// across client-side navigation (module state survives in the SPA session).
let pending: File | null = null;

export function setPendingPhoto(file: File): void {
  pending = file;
}

export function takePendingPhoto(): File | null {
  const file = pending;
  pending = null;
  return file;
}
