import { Router } from 'express';
import { asyncHandler as h } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { getDashboard } from '../services/dashboardService.js';
import { listAudit, listReports, resolveReport, reviewCipc, setBusinessSuspended, setUserSuspended } from '../services/adminService.js';
import { idParams } from '../validators/common.js';
import { auditQuery, cipcBody, dashboardParams, dashboardQuery, reportListQuery, resolveBody, suspendBody } from '../validators/admin.js';

/** /api/dashboard/:businessId — owner (or admin); ownership is checked in the service. */
export const dashboard = Router();
dashboard.get('/:businessId', requireAuth, validate({ params: dashboardParams, query: dashboardQuery }), h(async (req, res) => {
  res.json({ data: await getDashboard(req.params.businessId, req.user, req.validatedQuery) });
}));

/** /api/admin — admins only. */
export const admin = Router();
admin.use(requireAuth, requireRole('admin'));

admin.get('/reports', validate({ query: reportListQuery }), h(async (req, res) => {
  const { items, nextCursor } = await listReports(req.validatedQuery);
  res.json({ data: items, meta: { nextCursor, count: items.length } });
}));
admin.post('/reports/:id/resolve', validate({ params: idParams, body: resolveBody }), h(async (req, res) => {
  res.json({ data: await resolveReport(req.params.id, req.user, req.body) });
}));

admin.post('/users/:id/suspend', validate({ params: idParams, body: suspendBody }), h(async (req, res) => {
  res.json({ data: await setUserSuspended(req.params.id, req.user, true, req.body.reason) });
}));
admin.post('/users/:id/unsuspend', validate({ params: idParams, body: suspendBody }), h(async (req, res) => {
  res.json({ data: await setUserSuspended(req.params.id, req.user, false, req.body.reason) });
}));
admin.post('/businesses/:id/suspend', validate({ params: idParams, body: suspendBody }), h(async (req, res) => {
  res.json({ data: await setBusinessSuspended(req.params.id, req.user, true, req.body.reason) });
}));
admin.post('/businesses/:id/unsuspend', validate({ params: idParams, body: suspendBody }), h(async (req, res) => {
  res.json({ data: await setBusinessSuspended(req.params.id, req.user, false, req.body.reason) });
}));
admin.post('/businesses/:id/verify-cipc', validate({ params: idParams, body: cipcBody }), h(async (req, res) => {
  res.json({ data: await reviewCipc(req.params.id, req.user, req.body) });
}));

admin.get('/audit', validate({ query: auditQuery }), h(async (req, res) => {
  const { items, nextCursor } = await listAudit(req.validatedQuery);
  res.json({ data: items, meta: { nextCursor, count: items.length } });
}));
