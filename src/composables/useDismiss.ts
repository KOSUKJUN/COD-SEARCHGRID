import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * open 상태인 동안 바깥 클릭 / Esc 로 닫기.
 * @param inside 이 요소들 안의 클릭은 무시
 */
export function useDismiss(open: Ref<boolean>, inside: () => (HTMLElement | null | undefined)[], onClose: () => void) {
  const onPointer = (e: Event) => {
    const t = e.target as Node | null
    if (t && inside().some((el) => el?.contains(t))) return
    onClose()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }
  const add = () => {
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
  }
  const remove = () => {
    document.removeEventListener('pointerdown', onPointer, true)
    document.removeEventListener('keydown', onKey, true)
  }
  watch(open, (v) => (v ? add() : remove()), { immediate: true })
  onBeforeUnmount(remove)
}
