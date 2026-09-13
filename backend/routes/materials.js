const { Router } = require('express');
const path = require('node:path');
const { requireAuth, requireRoles, readSessionToken, digest } = require('../auth/middleware');
const library = require('../materials');

function materialRoutes(pool, config) {
    const router = Router();
    router.use(requireAuth);
    const directory = config.materialStorageDir || path.join(__dirname, '..', '.local-materials');
    const session = req => ({ userId: req.user.id, tokenHash: digest(readSessionToken(req, config)) });
    router.get('/', async (req, res) => res.json({ materials: await library.listMaterials(pool, req.user, req.query) }));
    router.get('/:id', async (req, res) => res.json(await library.materialDetail(pool, req.user, req.params.id)));
    router.post('/', async (req, res) => res.status(201).json({ material: await library.createMaterial(pool, session(req), req.body, directory) }));
    router.patch('/:id', requireRoles('admin', 'coordinator'), async (req, res) =>
        res.json({ material: await library.updateMaterial(pool, session(req), req.params.id, req.body) }));
    router.get('/:id/download', async (req, res) => {
        const file = await library.downloadMaterial(pool, req.user, req.params.id, directory);
        res.set('Content-Security-Policy', "sandbox; default-src 'none'");
        res.type(file.mime).attachment(file.fileName).send(file.bytes);
    });
    return router;
}
module.exports = { materialRoutes };
