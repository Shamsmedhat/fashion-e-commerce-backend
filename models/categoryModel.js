const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide the category name!'],
    trim: true,
    minLength: [3, 'Category name must have more than or equal 3 characters!'],
    maxLength: [45, 'Category name must have less than or equal 45 characters!'],
    set: function (val) {
      if (!val) return val;
      return val.charAt(0).toUpperCase() + val.slice(1);
    },
  },
  slug: String,
  path: { type: String, unique: true },
  parentId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    default: null,
  },
  isActive: { type: Boolean, select: false, default: true },
  createdAt: {
    type: Date,
    default: Date.now(),
  },
});

// Create slug, path
categorySchema.pre('save', async function () {
  if (!this.parentId) {
    this.slug = this.name.toLowerCase().trim();
    this.path = this.name.toLowerCase().trim();
  } else {
    const parentCategory = await Category.findById(this.parentId);

    this.slug = `${parentCategory.name.toLowerCase().trim()}-${this.name.toLowerCase().trim()}`;
    this.path = `${parentCategory.path}/${this.name.toLowerCase().trim()}`;
  }
});

// Update the category name in all docs
//? With AI help to get the idea of making a transaction
//? When we facing sort of bulk data updated
//? Code logic is in the Controller
categorySchema.pre('findOneAndUpdate', async function () {
  const update = this.getUpdate();
  const query = this.getQuery();

  // Skip delete
  if (!update) return;

  // Get the category from the param
  const category = await this.model.findOne(query);
  if (!category) return;

  // Check if name change
  const isNameChanged = update.name && update.name !== category.name;

  // Check if parentId change
  const isParentChanged =
    update.parentId && category.parentId?.toString() !== update.parentId.toString();

  // Nothing changed
  if (!isNameChanged && !isParentChanged) return;

  // Final category name
  const finalName = isNameChanged ? update.name : category.name;
  const finalNameLower = finalName.toLowerCase();

  // Determine parent
  let parentCategory = null;

  if (isParentChanged) {
    parentCategory = await this.model.findById(update.parentId);
    if (!parentCategory) {
      throw new Error('New parent category not found');
    }
  } else if (category.parentId) {
    parentCategory = await this.model.findById(category.parentId);
  }

  // Build new slug & path
  const newSlug = parentCategory ? `${parentCategory.slug}-${finalNameLower}` : finalNameLower;

  const newPath = parentCategory ? `${parentCategory.path}/${finalNameLower}` : finalNameLower;

  // Update current category
  update.slug = newSlug;
  update.path = newPath;

  // Cascade update children if path or slug changed
  if (newPath !== category.path || newSlug !== category.slug) {
    const oldPath = category.path;
    const oldSlug = category.slug;

    await this.model.updateMany(
      { path: { $regex: `^${oldPath}/` } },
      [
        {
          $set: {
            path: {
              $replaceOne: {
                input: '$path',
                find: oldPath,
                replacement: newPath,
              },
            },
            slug: {
              $replaceOne: {
                input: '$slug',
                find: oldSlug,
                replacement: newSlug,
              },
            },
          },
        },
      ],
      { updatePipeline: true },
    );
  }
});

const Category = mongoose.model('Category', categorySchema);
module.exports = Category;
