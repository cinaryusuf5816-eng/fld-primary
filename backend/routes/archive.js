const { Router } = require('express');
const path = require('node:path');
const { requireAuth, requireRoles, readSessionToken, digest } = require('../auth/middleware');
const library = require('../materials');
const archive = require('../archive');
const folders = require('../archive-folders');

function archiveRoutes(pool, config) {
    const router = Router();
    router.use(requireAuth);
    const directory = config.materialStorageDir || path.join(__dirname, '..', '.local-materials');
    const session = req => ({ userId: req.user.id, tokenHash: digest(readSessionToken(req, config)) });
    router.get('/', async (req, res) => res.json(await archive.listArchive(pool, req.user, req.query)));
    router.post('/', async (req, res) => res.status(201).json({ material: await library.createMaterial(pool, session(req), req.body, directory, { archive: true }) }));
    router.post('/bulk', requireRoles('admin', 'coordinator'), async (req, res) => res.json(await archive.bulkUpdateArchive(pool, session(req), req.body)));
    router.get('/folders', async (req, res) => res.json(await folders.listFolders(pool, req.user, req.query)));
    router.get('/folders/:id', async (req, res) => res.json(await folders.folderDetail(pool, req.user, req.params.id)));
    router.post('/folders', requireRoles('admin', 'coordinator'), async (req, res) => res.status(201).json(await folders.createFolder(pool, session(req), req.body)));
    router.patch('/folders/:id', requireRoles('admin', 'coordinator'), async (req, res) => res.json(await folders.renameFolder(pool, session(req), req.params.id, req.body)));
    router.delete('/folders/:id', requireRoles('admin'), async (req, res) => res.json(await folders.deleteFolder(pool, session(req), req.params.id, req.body)));
    router.post('/move', requireRoles('admin', 'coordinator'), async (req, res) => res.json(await folders.moveMaterials(pool, session(req), req.body)));
    router.get('/:id', async (req, res) => res.json(await library.materialDetail(pool, req.user, req.params.id)));
    router.patch('/:id', requireRoles('admin', 'coordinator'), async (req, res) => res.json({ material: await library.updateMaterial(pool, session(req), req.params.id, req.body, { archive: true }) }));
    router.delete('/:id', requireRoles('admin'), async (req, res) => res.json(await library.deleteMaterial(pool, session(req), req.params.id, directory, req.body)));
    return router;
}
module.exports = { archiveRoutes };
