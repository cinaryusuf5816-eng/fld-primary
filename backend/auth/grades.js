const { transaction } = require('../db');

const GRADES = Object.freeze(['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4']);
const privileged = user => ['admin', 'coordinator'].includes(user?.role) && user.is_active !== false && !user.deleted_at;
const activeStaff = user => user && ['admin', 'coordinator', 'teacher'].includes(user.role) && user.is_active !== false && !user.deleted_at;
const failure = (status, message) => Object.assign(new Error(message), { status });

function normalizeGrades(value) {
    if (!Array.isArray(value) || value.length > GRADES.length || value.some(grade => !GRADES.includes(grade)) || new Set(value).size !== value.length) {
        throw failure(400, 'Choose each valid grade at most once.');
    }
    return GRADES.filter(grade => value.includes(grade));
}
function canAccessGrade(user, grade) {
    return Boolean(activeStaff(user) && GRADES.includes(grade) &&
        (privileged(user) || (Array.isArray(user.grades) && user.grades.includes(grade))));
}
function canAccessAudience(user, grades) {
    if (!activeStaff(user) || !Array.isArray(grades) || grades.some(grade => !GRADES.includes(grade))) return false;
    return privileged(user) || grades.length === 0 || grades.some(grade => canAccessGrade(user, grade));
}
function assertGradeAccess(user, grade) {
    if (!canAccessGrade(user, grade)) throw failure(403, 'This grade is not assigned to your account.');
}
function assertAudienceAccess(user, grades) {
    if (!canAccessAudience(user, grades)) throw failure(403, 'This resource is not available to your grades.');
}
async function withActor(pool, session, action) {
    return transaction(pool, async client => {
        // Hold role, active state and grade assignments steady before locking
        // academic/library rows. This read never upgrades the users table lock.
        const result = await client.query('SELECT id, role, grades, is_active FROM users WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL FOR SHARE', [session.userId]);
        const actor = result.rows[0];
        if (!activeStaff(actor)) throw failure(401, 'Your account is no longer active.');
        const active = await client.query(`SELECT user_id FROM auth_sessions
            WHERE user_id = $1 AND token_hash = $2 AND expires_at > CURRENT_TIMESTAMP`, [actor.id, session.tokenHash]);
        if (!active.rows[0]) throw failure(401, 'Your session is no longer active.');
        return action(client, actor);
    });
}

module.exports = { GRADES, normalizeGrades, canAccessGrade, canAccessAudience, assertGradeAccess, assertAudienceAccess, withActor };
