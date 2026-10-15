import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { rootRoute } from './root.routes'

export const transferRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'transfer',
  component: lazyRouteComponent(() => import('@/transfer/PageTransfer'), 'PageTransfer'),
  head: () => ({ meta: [{ title: 'Fund Relay wallet' }] }),
})
