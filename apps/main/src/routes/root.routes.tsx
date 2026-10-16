import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { CurveLayout } from './RootLayout'

export const rootRoute = createRootRoute({
  component: Outlet,
  // todo: head: () => ({meta: [{'og:image': CURVE_LOGO_URL, 'twitter:image': CURVE_LOGO_URL}]}),
})

export const curveRoute = createRoute({ getParentRoute: () => rootRoute, id: 'curve', component: CurveLayout })
