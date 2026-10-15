import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { redirectTo } from '@ui/hooks/router'
import { curveRoute } from './root.routes'
import { createSharedRoutes } from './shared.routes'

const MarketsList = lazyRouteComponent(() => import('@/llamalend/features/market-list'), 'MarketsList')

const llamalendLayoutRoute = createRoute({ getParentRoute: () => curveRoute, path: 'llamalend' })

const layoutProps = { getParentRoute: () => llamalendLayoutRoute }

export const llamalendRoutes = llamalendLayoutRoute.addChildren([
  ...createSharedRoutes('llamalend', layoutProps),
  createRoute({
    path: '$network',
    loader: ({ params: { network } }) => redirectTo(`/llamalend/${network}/markets/`),
    ...layoutProps,
  }),
  createRoute({
    path: '$network/markets',
    component: MarketsList,
    head: () => ({ meta: [{ title: 'Markets - Curve' }] }),
    ...layoutProps,
  }),
])
