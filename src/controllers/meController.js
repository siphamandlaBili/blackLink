import { myEngagement } from '../services/engagementService.js';
import { deleteMyAccount, exportMyData } from '../services/privacyService.js';
import { updatePreferences } from '../services/userService.js';
import { userToSelf } from '../utils/serializers.js';

/** GET /api/me — the signed-in user's own account. */
export const getMe = (req, res) => {
  res.json({ data: userToSelf(req.user) });
};

/** GET /api/me/engagement — ids the signed-in user saved, follows and is going to (for the app's toggles). */
export const getEngagement = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await myEngagement(req.user._id) });
};

/** PATCH /api/me/preferences */
export const patchPreferences = async (req, res) => {
  const user = await updatePreferences(req.user._id, req.body);
  res.json({ data: userToSelf(user) });
};

/** GET /api/me/export — everything we hold about you, as a downloadable JSON file. */
export const exportData = async (req, res) => {
  const data = await exportMyData(req.user._id);
  res.set('Content-Disposition', `attachment; filename="black-link-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.set('Cache-Control', 'no-store');
  res.json({ data });
};

/** DELETE /api/me { confirm: "DELETE" } — deletes your account (POPIA). */
export const deleteAccount = async (req, res) => {
  res.json({ data: await deleteMyAccount(req.user) });
};
