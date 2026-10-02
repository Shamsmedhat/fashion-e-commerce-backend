const AppError = require('./appError');

const RANGE_OPERATORS = ['gt', 'gte', 'lt', 'lte'];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Reads a positive integer query value, falling back to a default when it is absent.
const parsePositiveInt = (value, fallback, name) => {
  if (value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError(`Query parameter "${name}" must be a positive integer.`, 400);
  }

  return parsed;
};

// Turns one query-string value into a safe Mongo condition. Only equality, lists and the four range
// operators are accepted, so operators such as $where or $ne can never reach the database.
const toCondition = (field, value) => {
  if (value === null || typeof value === 'string') return value;

  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string')) return { $in: value };
  } else if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const isRange = entries.every(
      ([operator, operand]) => RANGE_OPERATORS.includes(operator) && typeof operand === 'string',
    );

    if (entries.length && isRange) {
      return Object.fromEntries(entries.map(([operator, operand]) => [`$${operator}`, operand]));
    }
  }

  throw new AppError(`Invalid filter for "${field}".`, 400);
};

class APIFeatures {
  // filterableFields / sortableFields are allowlists: anything else in the query string is ignored,
  // so tracking parameters (utm_source, fbclid, ...) never turn into database filters.
  constructor(query, queryStr, { filterableFields = [], sortableFields = [] } = {}) {
    this.query = query;
    this.queryStr = queryStr;
    this.filterableFields = filterableFields;
    this.sortableFields = sortableFields;
  }

  // A) Filter
  filter() {
    const conditions = {};

    this.filterableFields.forEach((field) => {
      const value = this.queryStr[field];
      if (value !== undefined) conditions[field] = toCondition(field, value);
    });

    // $and keeps these conditions from overwriting filters the caller already applied.
    if (Object.keys(conditions).length) this.query = this.query.and([conditions]);

    return this;
  }

  // B) Sort
  sort() {
    const requested = [this.queryStr.sort]
      .flat()
      .filter((entry) => typeof entry === 'string')
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => this.sortableFields.includes(entry.replace(/^-/, '')));

    const sortBy = requested.length ? requested : ['-createdAt'];

    // _id as a tiebreaker keeps pages stable when many documents share the same sort value.
    this.query = this.query.sort([...sortBy, '_id'].join(' '));

    return this;
  }

  // C) Fields limiting (select)
  limitFields() {
    const fields =
      typeof this.queryStr.fields === 'string'
        ? this.queryStr.fields.split(',').filter((field) => /^[\w.]+$/.test(field))
        : [];

    this.query = this.query.select(fields.length ? fields.join(' ') : '-__v');

    return this;
  }

  // D) Pagination
  paginate() {
    const page = parsePositiveInt(this.queryStr.page, 1, 'page');
    const limit = Math.min(
      parsePositiveInt(this.queryStr.limit, DEFAULT_LIMIT, 'limit'),
      MAX_LIMIT,
    );

    this.query = this.query.skip((page - 1) * limit).limit(limit);

    return this;
  }
}

module.exports = APIFeatures;
