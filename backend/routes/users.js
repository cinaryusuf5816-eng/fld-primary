const { Router } = require('express');
const { requireRoles, PUBLIC_USER_FIELDS } = require('../auth/middleware');
const { createUser, updateUser, removeUser } = require('../auth/users');

function userRoutes(pool) {
    const router = Router();
    router.use(requireRoles('admin'));
    router.get('/', async (req, res) => {
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
        const result = await pool.query(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT $1 OFFSET $2`, [limit, offset]);
        res.json({ users: result.rows, limit, offset });
    });
    router.post('/', async (req, res) => res.status(201).json({ user: await createUser(pool, req.user.id, req.body) }));
    router.param('id', (req, res, next, id) => {
        if (!/^(\d{1,19}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(id)) {
            return res.status(400).json({ error: 'Invalid user ID.' });
        }
        next();
    });
    router.patch('/:id', async (req, res) => {
        res.json({ user: await updateUser(pool, req.user.id, req.params.id, req.body) });
    });
    router.post('/:id/remove', async (req, res) => {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) {
            return res.status(400).json({ error: 'Expected an empty JSON object.' });
        }
        res.json({ user: await removeUser(pool, req.user.id, req.params.id) });
    });
    return router;
}
module.exports = { userRoutes };
