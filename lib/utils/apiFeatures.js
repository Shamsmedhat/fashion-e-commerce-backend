class APIFeatures {
  constructor(query, queryStr) {
    this.query = query;
    this.queryStr = queryStr;
  }

  // A) Filter
  filter() {
    const queryObj = { ...this.queryStr };
    const excludedQueries = ['sort', 'page', 'limit', 'fields', 'mainCategory'];
    excludedQueries.forEach((el) => delete queryObj[el]);

    // A.1 Advanced filter (If there is any [gt|gte|lt|lte] add the '$')
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gt|gte|lt|lte)\b/g, (match) => `$${match}`);
    let finalQuery = JSON.parse(queryStr);

    // 1.1 Return only the query
    this.query = this.query.find(finalQuery);
    return this;
  }

  // B) Sort
  sort() {
    if (this.queryStr.sort) {
      const sortBy = this.queryStr.sort.split(',').join(' ');
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort('-createdAt');
    }

    return this;
  }

  // C) Fields limiting (select)
  limitFields() {
    if (this.queryStr.fields) {
      const fields = this.queryStr.fields.split(',').join(' ');
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select('-__v');
    }
    return this;
  }

  // D) Pagination
  paginate() {
    const page = this.queryStr.page * 1 || 1;
    const limit = this.queryStr.limit * 1 || 10;
    const skip = (page - 1) * limit;
    this.query = this.query.skip(skip).limit(limit);

    return this;
  }
}

module.exports = APIFeatures;
