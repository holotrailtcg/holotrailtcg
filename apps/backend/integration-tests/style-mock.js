// Jest has no CSS loader; Admin route files import a scoped stylesheet for
// its side effects only, so component specs map that import to this empty
// stub instead of teaching Jest to parse CSS.
module.exports = {}
