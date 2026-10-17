const { pool } = require('../config/db');
const fs = require('fs');
const path = require('path');
const { deleteStoredImage } = require('../config/cloudinary');

// Get all products with optional filters
exports.getProducts = async (req, res) => {
  try {
    const { roast, origin, search, sort, inStockOnly } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (roast && roast !== 'All') {
      query += ' AND roast_level = ?';
      params.push(roast);
    }

    if (origin && origin !== 'All') {
      query += ' AND origin LIKE ?';
      params.push(`%${origin}%`);
    }

    if (inStockOnly === 'true') {
      query += ' AND stock_quantity > 0';
    }

    if (search) {
      query += ' AND (name LIKE ? OR tagline LIKE ? OR flavor_notes LIKE ? OR description LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam);
    }

    if (sort === 'price_asc') {
      query += ' ORDER BY price ASC';
    } else if (sort === 'price_desc') {
      query += ' ORDER BY price DESC';
    } else if (sort === 'stock') {
      query += ' ORDER BY stock_quantity DESC';
    } else if (sort === 'name') {
      query += ' ORDER BY name ASC';
    } else {
      query += ' ORDER BY is_featured DESC, id DESC';
    }

    const [rows] = await pool.query(query, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving products', error: error.message });
  }
};

// Get single product by ID
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving product', error: error.message });
  }
};

// Create a new product
exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      tagline,
      description,
      price,
      origin,
      roast_level,
      grind_types,
      flavor_notes,
      acidity,
      body,
      stock_quantity,
      is_featured,
      image_url: customImageUrl
    } = req.body;

    if (!name || !price) {
      return res.status(400).json({ success: false, message: 'Product name and price are required' });
    }

    // Determine image URL: either uploaded file or URL provided in body
    let finalImageUrl = customImageUrl || '';
    if (req.file) {
      if (req.file.path && (req.file.path.startsWith('http://') || req.file.path.startsWith('https://'))) {
        finalImageUrl = req.file.path;
      } else if (req.file.filename) {
        finalImageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO products 
      (name, tagline, description, price, origin, roast_level, grind_types, flavor_notes, acidity, body, stock_quantity, is_featured, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        tagline || '',
        description || '',
        parseFloat(price) || 0,
        origin || 'Single Origin',
        roast_level || 'Medium',
        grind_types || 'Whole Bean, Pour Over, Espresso, French Press',
        flavor_notes || '',
        parseInt(acidity, 10) || 3,
        parseInt(body, 10) || 3,
        parseInt(stock_quantity, 10) >= 0 ? parseInt(stock_quantity, 10) : 50,
        is_featured ? 1 : 0,
        finalImageUrl
      ]
    );

    const [newProduct] = await pool.query('SELECT * FROM products WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, message: 'Product created successfully', data: newProduct[0] });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, message: 'Server error creating product', error: error.message });
  }
};

// Update an existing product
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      tagline,
      description,
      price,
      origin,
      roast_level,
      grind_types,
      flavor_notes,
      acidity,
      body,
      stock_quantity,
      is_featured,
      image_url: customImageUrl
    } = req.body;

    const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    let finalImageUrl = existing[0].image_url;
    if (req.file) {
      if (existing[0].image_url) {
        deleteStoredImage(existing[0].image_url).catch(err => console.warn('Failed to delete old image:', err.message));
      }
      if (req.file.path && (req.file.path.startsWith('http://') || req.file.path.startsWith('https://'))) {
        finalImageUrl = req.file.path;
      } else if (req.file.filename) {
        finalImageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      }
    } else if (customImageUrl !== undefined) {
      finalImageUrl = customImageUrl;
    }

    await pool.query(
      `UPDATE products SET 
        name = ?, tagline = ?, description = ?, price = ?, origin = ?, 
        roast_level = ?, grind_types = ?, flavor_notes = ?, acidity = ?, 
        body = ?, stock_quantity = ?, is_featured = ?, image_url = ?
       WHERE id = ?`,
      [
        name !== undefined ? name : existing[0].name,
        tagline !== undefined ? tagline : existing[0].tagline,
        description !== undefined ? description : existing[0].description,
        price !== undefined ? parseFloat(price) : existing[0].price,
        origin !== undefined ? origin : existing[0].origin,
        roast_level !== undefined ? roast_level : existing[0].roast_level,
        grind_types !== undefined ? grind_types : existing[0].grind_types,
        flavor_notes !== undefined ? flavor_notes : existing[0].flavor_notes,
        acidity !== undefined ? parseInt(acidity, 10) : existing[0].acidity,
        body !== undefined ? parseInt(body, 10) : existing[0].body,
        stock_quantity !== undefined ? parseInt(stock_quantity, 10) : existing[0].stock_quantity,
        is_featured !== undefined ? (is_featured ? 1 : 0) : existing[0].is_featured,
        finalImageUrl,
        id
      ]
    );

    const [updated] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    res.json({ success: true, message: 'Product updated successfully', data: updated[0] });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, message: 'Server error updating product', error: error.message });
  }
};

// Quick Stock Update endpoint
exports.updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock_quantity } = req.body;

    if (stock_quantity === undefined || isNaN(stock_quantity)) {
      return res.status(400).json({ success: false, message: 'Valid stock quantity is required' });
    }

    const qty = Math.max(0, parseInt(stock_quantity, 10));
    await pool.query('UPDATE products SET stock_quantity = ? WHERE id = ?', [qty, id]);
    const [updated] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);

    res.json({ success: true, message: 'Stock updated successfully', data: updated[0] });
  } catch (error) {
    console.error('Error updating stock:', error);
    res.status(500).json({ success: false, message: 'Server error updating stock', error: error.message });
  }
};

// Remove image from product
exports.removeProductImage = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const oldImageUrl = existing[0].image_url;
    if (oldImageUrl) {
      await deleteStoredImage(oldImageUrl);
    }

    await pool.query('UPDATE products SET image_url = "" WHERE id = ?', [id]);
    const [updated] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);

    res.json({ success: true, message: 'Product image removed successfully', data: updated[0] });
  } catch (error) {
    console.error('Error removing product image:', error);
    res.status(500).json({ success: false, message: 'Server error removing image', error: error.message });
  }
};

// Delete product
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const oldImageUrl = existing[0].image_url;
    if (oldImageUrl) {
      await deleteStoredImage(oldImageUrl);
    }

    await pool.query('DELETE FROM products WHERE id = ?', [id]);
    res.json({ success: true, message: 'Product deleted successfully', id: parseInt(id, 10) });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: 'Server error deleting product', error: error.message });
  }
};
