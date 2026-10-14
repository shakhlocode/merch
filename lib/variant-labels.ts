export function displayColor(color: string | null | undefined) {
  const value = color?.trim()
  return !value || value.toLowerCase() === 'без цвета' ? 'Как на фото' : value
}

export function displaySize(size: string | null | undefined) {
  const value = size?.trim()
  return !value || /^one[\s_-]*size$/i.test(value) ? 'Стандартный' : value
}
