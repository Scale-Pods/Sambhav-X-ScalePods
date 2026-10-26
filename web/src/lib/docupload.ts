export const MAX_DOC_BYTES = 25 * 1024 * 1024;
/** The shape of a stored file's name: year-month / id - a cleaned file name. The same rule is in the database and the storage policy. */
export const DOC_PATH = /^[0-9]{4}-[0-9]{2}\/[0-9a-f-]{36}-[A-Za-z0-9._-]{0,80}$/;
