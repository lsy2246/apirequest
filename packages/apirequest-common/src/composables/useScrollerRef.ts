import { ref, onMounted, onBeforeUnmount } from "vue"
import { useService } from "dioc/vue"
import { ScrollService } from "~/services/scroll.service"

/**
 * A composable used to automatically restore and save scroll position
 * inside a scrollable element (e.g., .cm-scroller) within a container.
 *
 * @param label - Label used in error logging
 * @param classSelector - CSS selector for the scrollable element
 * @param initialScrollTop - Optional fallback scroll position
 * @param scrollKey - Unique key used for saving/restoring scroll state via ScrollService
 */
export function useScrollerRef(
  label: string = "Lens",
  classSelector: string = ".cm-scroller",
  initialScrollTop?: number,
  scrollKey?: string
) {
  // Container element ref (typically the root of the scrollable section)
  const containerRef = ref<HTMLElement | null>(null)

  // Ref for the actual scrollable element inside the container
  const scrollerRef = ref<HTMLElement | null>(null)

  // Inject the ScrollService to access stored scroll positions
  const scrollService = useService(ScrollService)

  /**
   * Wait for the editor scroller to mount. Short responses do not need overflow.
   * Retries for a limited number of times before failing.
   */
  let isUnmounted = false
  function waitUntilScrollable(
    maxTries = 60,
    delay = 16
  ): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
      let tries = 0

      const tryFind = () => {
        if (isUnmounted) {
          reject(new Error(`[${label}] Aborted: component unmounted`))
          return
        }

        const scroller = containerRef.value?.querySelector(
          classSelector
        ) as HTMLElement | null

        if (scroller) {
          resolve(scroller) // Short or empty responses still have a valid editor scroller.
          return
        }

        tries++
        if (tries >= maxTries) {
          reject(
            new Error(`[${label}] Timeout: ${classSelector} did not mount`)
          )
        } else {
          setTimeout(tryFind, delay) // Retry after delay
        }
      }

      tryFind()
    })
  }

  // Scroll event handler to save scroll position
  let onScroll: (() => void) | null = null

  onMounted(async () => {
    try {
      const scroller = await waitUntilScrollable()
      scrollerRef.value = scroller

      // Restore scroll position from service (if available)
      requestAnimationFrame(() => {
        if (
          scrollKey &&
          scrollService.getScrollForKey(scrollKey) !== undefined
        ) {
          scroller.scrollTop = scrollService.getScrollForKey(scrollKey)!
        } else if (initialScrollTop !== undefined) {
          scroller.scrollTop = initialScrollTop
        }
      })

      // Register scroll event to update position in ScrollService
      onScroll = () => {
        if (scrollKey) {
          scrollService.setScrollForKey(scrollKey, scroller.scrollTop)
        }
      }

      scroller.addEventListener("scroll", onScroll)
    } catch (error: any) {
      console.error(`[${label}] Failed to initialize scroller:`, error.message)
    }
  })

  // Clean up scroll listener on unmount
  onBeforeUnmount(() => {
    isUnmounted = true
    if (scrollerRef.value && onScroll) {
      scrollerRef.value.removeEventListener("scroll", onScroll)
    }
  })

  return { containerRef, scrollerRef }
}
