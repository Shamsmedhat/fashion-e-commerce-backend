const mongoose = require('mongoose');
const AppError = require('../lib/utils/appError');

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
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Create slug, path
categorySchema.pre('save', async function () {
  const name = this.name.toLowerCase().trim();

  if (!this.parentId) {
    this.slug = name;
    this.path = name;
    return;
  }

  const parentCategory = await Category.findById(this.parentId).session(this.$session());
  if (!parentCategory) throw new AppError('Parent category not found!', 400);

  this.slug = `${parentCategory.slug}-${name}`;
  this.path = `${parentCategory.path}/${name}`;
});

// Update the category name in all docs
//? With AI help to get the idea of making a transaction
//? When we facing sort of bulk data updated
//? Code logic is in the Controller
categorySchema.pre('findOneAndUpdate', async function () {
  const update = this.getUpdate();

  // Skip delete
  if (!update) return;

  // Every query below joins the caller's transaction, so the cascade commits or rolls back with it.
  const { session } = this.getOptions();

  // Get the category from the param
  const category = await this.model.findOne(this.getQuery()).session(session);
  if (!category) return;

  // Check if name change
  const isNameChanged = update.name !== undefined && update.name !== category.name;

  // Check if parentId change (null moves the category to the top level)
  const hasParentUpdate = Object.prototype.hasOwnProperty.call(update, 'parentId');
  const newParentId = hasParentUpdate ? update.parentId : category.parentId;
  const isParentChanged =
    hasParentUpdate && String(newParentId || '') !== String(category.parentId || '');

  // Nothing changed
  if (!isNameChanged && !isParentChanged) return;

  // Final category name
  const finalNameLower = (isNameChanged ? update.name : category.name).toLowerCase().trim();

  // Determine parent
  let parentCategory = null;

  if (newParentId) {
    parentCategory = await this.model.findById(newParentId).session(session);
    if (!parentCategory) throw new AppError('Parent category not found!', 400);

    // Moving a category below itself would detach the whole branch from the tree.
    const isSelf = parentCategory._id.equals(category._id);
    const isDescendant = parentCategory.path.startsWith(`${category.path}/`);
    if (isSelf || isDescendant) {
      throw new AppError(
        'A category cannot be moved under itself or one of its subcategories!',
        400,
      );
    }
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
      { path: { $regex: `^${escapeRegExp(oldPath)}/` } },
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
      { updatePipeline: true, session },
    );
  }
});

const Category = mongoose.model('Category', categorySchema);
module.exports = Category;
