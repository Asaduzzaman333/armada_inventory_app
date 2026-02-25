/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// Firebase SDKs
import { initializeApp } from 'firebase/app';
// Analytics was imported but not used, so it's removed.
// import { getAnalytics } from 'firebase/analytics'; 
import { 
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { 
  getDatabase,
  ref as dbRef, 
  set,
  get,
  onValue,
  update,
  remove,
  push,
  child,
} from 'firebase/database';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAE6DsJeTnj5GeUTi2d77GRaywdaP0c-Kw",
  authDomain: "inventory-363c8.firebaseapp.com",
  databaseURL: "https://inventory-363c8-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "inventory-363c8",
  storageBucket: "inventory-363c8.firebasestorage.app", // Kept for consistency, though not used
  messagingSenderId: "971715277392",
  appId: "1:971715277392:web:6762c17a930462008b9755"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
// const analytics = getAnalytics(firebaseApp); // Removed
const rtdb = getDatabase(firebaseApp); // Initialize Realtime Database
const auth = getAuth(firebaseApp);

const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;
type Size = typeof SIZES[number];

// UserDocument interface not used; admin auth handled via Firebase Auth

interface CategoryDefinition {
  id: string; 
  name: string;
  subcategories: string[];
}

interface InventoryItem {
  id: string; 
  name: string;
  sku: string;
  category: string; 
  subcategory: string; 
  sizes: Record<Size, number>;
  price: number;
  description?: string;
  imageUrl?: string;
}

const APP_HISTORY_KEY = 'inventory-app';

interface AppHistoryState {
  __app: typeof APP_HISTORY_KEY;
  viewMode: 'admin' | 'stock';
  selectedCategoryForView: string | null;
  selectedSubcategoryForView: string | null;
  historyIndex: number;
}

const calculateTotalQuantity = (sizes: Record<Size, number>): number => {
  return SIZES.reduce((sum, size) => sum + (sizes[size] || 0), 0);
};

type CsvValue = string | number;

const sanitizeFilenamePart = (value: string): string => {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .trim();
};

const formatCsvValue = (value: CsvValue): string => {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsvContent = (rows: CsvValue[][]): string => {
  return rows.map((row) => row.map(formatCsvValue).join(',')).join('\r\n');
};

const buildSubcategoryExportFilename = (categoryName: string, subcategoryName: string): string => {
  const safeCategory = sanitizeFilenamePart(categoryName);
  const safeSubcategory = sanitizeFilenamePart(subcategoryName);
  const baseName = [safeCategory || 'category', safeSubcategory || 'subcategory', 'stock']
    .filter(Boolean)
    .join('_');
  return `${baseName || 'subcategory_stock'}.csv`;
};

const downloadCsvFile = (filename: string, rows: CsvValue[][]): void => {
  // Prefix with BOM for Excel UTF-8 support.
  const csvContent = `\ufeff${buildCsvContent(rows)}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

interface ProductStockViewProps {
  items: InventoryItem[];
  allCategories: CategoryDefinition[];
  selectedCategoryName: string | null;
  selectedSubcategoryName: string | null;
  onSelectCategory: (categoryName: string) => void;
  onSelectSubcategory: (categoryName: string, subcategoryName: string) => void;
  onNavigateBack: () => void;
  onSellItemSize: (itemId: string, size: Size) => void;
  getCategoryItemCount: (categoryName: string, subcategoryName: string) => number;
  isAdmin: boolean;
  // currentUser prop removed
}

const ProductStockView: React.FC<ProductStockViewProps> = ({
  items,
  allCategories,
  selectedCategoryName,
  selectedSubcategoryName,
  onSelectCategory,
  onSelectSubcategory,
  onNavigateBack,
  onSellItemSize,
  getCategoryItemCount,
  isAdmin,
}) => {
  const handleExportSubcategory = () => {
    if (!selectedCategoryName || !selectedSubcategoryName) return;

    const headerRow: CsvValue[] = ['Name', 'Image URL', ...SIZES];
    const dataRows: CsvValue[][] = items.map(item => ([
      item.name,
      item.imageUrl || '',
      ...SIZES.map(size => item.sizes[size] || 0),
    ]));

    const filename = buildSubcategoryExportFilename(selectedCategoryName, selectedSubcategoryName);
    downloadCsvFile(filename, [headerRow, ...dataRows]);
  };

  if (!selectedCategoryName) {
    return (
      <div className="category-selection-container">
        <h2>Shop by Category</h2>
        {allCategories.filter(cat => cat.name !== 'Uncategorized' || cat.subcategories.some(subcat => getCategoryItemCount(cat.name, subcat) > 0)).length === 0 && (
           <p className="empty-state-text">No categories with products available. Add categories and products in the admin panel.</p>
        )}
        <div className="category-grid">
          {allCategories.map(category => {
             const totalItemsInCategory = category.subcategories.reduce((sum, subcat) => sum + getCategoryItemCount(category.name, subcat), 0);
             if (category.name === 'Uncategorized' && totalItemsInCategory === 0 && !category.subcategories.includes('Default')) { 
                 return null;
             }
             if (category.name === 'Uncategorized' && totalItemsInCategory === 0 && !(category.subcategories.length === 1 && category.subcategories[0] === 'Default')) {
                return null;
             }
            return (
              <button
                key={category.id}
                onClick={() => onSelectCategory(category.name)}
                className="category-card btn"
                aria-label={`View products in ${category.name}`}
              >
                {category.name}
                <span className="item-count-badge">{totalItemsInCategory} items</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (!selectedSubcategoryName) {
    const category = allCategories.find(cat => cat.name === selectedCategoryName);
    if (!category) return <p className="empty-state-text">Category not found.</p>;
    
    const visibleSubcategories = category.subcategories.filter(subcat => getCategoryItemCount(category.name, subcat) > 0 || subcat === 'Default');
    
    return (
      <div className="category-selection-container">
        <div className="navigation-header">
          <button onClick={onNavigateBack} className="btn btn-secondary btn-sm btn-back-nav">
            &larr; Back to Categories
          </button>
          <h2>{selectedCategoryName} &gt; Select Subcategory</h2>
        </div>
         {visibleSubcategories.length === 0 && (
           <p className="empty-state-text">No subcategories with products available in {category.name}. Add products to this subcategory or create new subcategories in the admin panel.</p>
        )}
        <div className="category-grid">
          {category.subcategories.map(subcategory => { 
            const itemCount = getCategoryItemCount(category.name, subcategory);
            if (itemCount === 0 && subcategory !== 'Default') return null;

            if (category.name === 'Uncategorized' && subcategory === 'Default' && itemCount === 0 && category.subcategories.length > 1) {
              const otherUncategorizedSubcatsHaveItems = category.subcategories.filter(s => s !== 'Default').some(s => getCategoryItemCount(category.name, s) > 0);
              if (otherUncategorizedSubcatsHaveItems) return null;
            }

            return (
              <button
                key={subcategory}
                onClick={() => onSelectSubcategory(category.name, subcategory)}
                className="category-card btn"
                aria-label={`View products in ${subcategory}`}
              >
                {subcategory}
                <span className="item-count-badge">{itemCount} items</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="product-stock-view-container">
      <div className="navigation-header full-width-header">
        <button onClick={onNavigateBack} className="btn btn-secondary btn-sm btn-back-nav">
          &larr; Back to Subcategories
        </button>
        <h2>{selectedCategoryName} &gt; {selectedSubcategoryName}</h2>
      </div>
      {isAdmin && (
        <div className="subcategory-export-bar">
          <button
            onClick={handleExportSubcategory}
            className="btn btn-success"
            aria-label={`Export ${selectedCategoryName} ${selectedSubcategoryName} stock to CSV`}
            disabled={items.length === 0}
          >
            Export Excel (CSV)
          </button>
        </div>
      )}
      {items.length === 0 && (
        <div className="product-stock-view-container empty-state full-span-empty">
          <h2>No products found in this subcategory.</h2>
          <p>Admins can add products in the admin panel.</p>
        </div>
      )}
      {items.map(item => (
        <div key={item.id} className="product-stock-card">
          <div className="product-stock-card-header">
            <div className="product-stock-card-details">
              <h3>{item.name}</h3>
              <p className="sku">SKU: {item.sku}</p>
              <p className="price">Price: ৳{item.price.toFixed(2)}</p>
              <p className="current-stock">Available Stock: {calculateTotalQuantity(item.sizes)}</p>
              {item.description && <p className="description">{item.description}</p>}
            </div>
            {item.imageUrl && (
              <div className="product-image-container">
                <img
                  src={item.imageUrl}
                  alt={`${item.name} product`}
                  className="product-image"
                  loading="lazy"
                />
              </div>
            )}
          </div>
          <div className="sizes-overview">
            <h4>Available Stock by Size:</h4>
            <ul>
              {SIZES.map(size => (
                <li key={size}>
                  <span className="size-label">{size}:</span>
                  <span className="size-quantity">{item.sizes[size] || 0}</span>
                  {isAdmin && (
                    <button
                      onClick={() => onSellItemSize(item.id, size)}
                      disabled={(item.sizes[size] || 0) === 0}
                      className="btn btn-sell-size"
                      aria-label={`Sell one ${size} of ${item.name}`}
                    >
                      Sell 1
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
};

// Login view is rendered inline inside App

interface AdminCategoryManagerProps {
  categories: CategoryDefinition[];
  onAddCategory: (categoryName: string) => Promise<void>;
  onDeleteCategory: (categoryId: string, categoryName: string) => Promise<void>;
  onAddSubcategory: (categoryId: string, categoryName: string, subcategoryName: string) => Promise<void>;
  onDeleteSubcategory: (categoryId: string, categoryName: string, subcategoryName: string) => Promise<void>;
  items: InventoryItem[];
}

const AdminCategoryManager: React.FC<AdminCategoryManagerProps> = ({
  categories,
  onAddCategory,
  onDeleteCategory,
  onAddSubcategory,
  onDeleteSubcategory,
  items
}) => {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [selectedCategoryForNewSub, setSelectedCategoryForNewSub] = useState<string>(categories[0]?.id || '');

  useEffect(() => {
    if (categories.length > 0) {
        if (!selectedCategoryForNewSub || !categories.find(c => c.id === selectedCategoryForNewSub)) {
            const firstValidCategory = categories.find(c => c.name !== 'Uncategorized') || categories[0];
            if (firstValidCategory) {
                setSelectedCategoryForNewSub(firstValidCategory.id);
            } else {
                setSelectedCategoryForNewSub('');
            }
        }
    } else {
        setSelectedCategoryForNewSub('');
    }
  }, [categories, selectedCategoryForNewSub]);

  const handleAddCategoryInternal = async () => {
    if (newCategoryName.trim() && !categories.find(cat => cat.name.toLowerCase() === newCategoryName.trim().toLowerCase())) {
      await onAddCategory(newCategoryName.trim());
      setNewCategoryName('');
    } else {
      alert("Category name cannot be empty or already exists.");
    }
  };

  const handleAddSubcategoryInternal = async () => {
    const category = categories.find(cat => cat.id === selectedCategoryForNewSub);
    if (category && category.name !== 'Uncategorized' && newSubcategoryName.trim() && !category.subcategories.find(sub => sub.toLowerCase() === newSubcategoryName.trim().toLowerCase())) {
      await onAddSubcategory(category.id, category.name, newSubcategoryName.trim());
      setNewSubcategoryName('');
    } else {
       alert("Subcategory name cannot be empty, already exists, or no valid category is selected. 'Uncategorized' cannot have subcategories added this way.");
    }
  };
  
  const isCategoryInUse = (categoryName: string): boolean => {
    return items.some(item => item.category === categoryName);
  };

  const isSubcategoryInUse = (categoryName: string, subcategoryName: string): boolean => {
    return items.some(item => item.category === categoryName && item.subcategory === subcategoryName);
  };

  return (
    <div className="admin-category-manager">
      <h3>Manage Categories & Subcategories</h3>
      <div className="category-forms-grid">
        <div className="form-section">
          <h4>Add New Category</h4>
          <div className="form-group inline-form-group">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Category Name"
              aria-label="New category name"
            />
            <button onClick={handleAddCategoryInternal} className="btn btn-success btn-sm">Add Category</button>
          </div>
        </div>

        <div className="form-section">
          <h4>Add New Subcategory</h4>
          {categories.filter(c => c.name !== 'Uncategorized').length > 0 ? (
            <>
              <div className="form-group">
                <select
                  value={selectedCategoryForNewSub}
                  onChange={(e) => setSelectedCategoryForNewSub(e.target.value)}
                  aria-label="Select category to add subcategory to"
                  disabled={categories.filter(c => c.name !== 'Uncategorized').length === 0}
                >
                  {categories.filter(c => c.name !== 'Uncategorized').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </div>
              <div className="form-group inline-form-group">
                <input
                  type="text"
                  value={newSubcategoryName}
                  onChange={(e) => setNewSubcategoryName(e.target.value)}
                  placeholder="Subcategory Name"
                  aria-label="New subcategory name"
                />
                <button onClick={handleAddSubcategoryInternal} className="btn btn-success btn-sm" disabled={!selectedCategoryForNewSub}>Add Subcategory</button>
              </div>
            </>
          ) : <p>Create a non-'Uncategorized' category first to add subcategories.</p>}
        </div>
      </div>

      <h4>Existing Categories</h4>
      {categories.length === 0 && <p className="empty-state-text">No categories defined yet. Add a category to get started.</p>}
      <ul className="category-list">
        {categories.map(category => (
          <li key={category.id} className="category-list-item">
            <div className="category-header">
              <strong>{category.name}</strong>
              <button
                onClick={async () => {
                  if (category.name === 'Uncategorized') {
                    alert('The "Uncategorized" category cannot be deleted.');
                    return;
                  }
                  const inUse = isCategoryInUse(category.name);
                  let confirmMessage = `Are you sure you want to delete category "${category.name}" and all its subcategories?`;
                  if (inUse) {
                    confirmMessage += `\n\nProducts currently in this category will be moved to "Uncategorized / Default".`;
                  }
                  if (window.confirm(confirmMessage)) {
                    await onDeleteCategory(category.id, category.name);
                  }
                }}
                className="btn btn-danger btn-xs"
                disabled={category.name === 'Uncategorized'}
                aria-label={`Delete category ${category.name}`}
              >
                Delete Category
              </button>
            </div>
            {category.subcategories.length > 0 ? (
              <ul className="subcategory-list">
                {category.subcategories.map(subcategory => (
                  <li key={subcategory} className="subcategory-list-item">
                    <span>{subcategory}</span>
                    <button
                      onClick={async () => {
                        if (category.name === 'Uncategorized' && subcategory === 'Default') {
                          alert('The "Default" subcategory within "Uncategorized" cannot be deleted.');
                          return;
                        }
                         if (subcategory === 'Default' && category.name !== 'Uncategorized' && category.subcategories.length === 1) {
                            alert(`The "Default" subcategory cannot be deleted from "${category.name}" if it's the only subcategory. Add another subcategory first or delete the parent category.`);
                            return;
                         }
                        const inUse = isSubcategoryInUse(category.name, subcategory);
                        let confirmMessage = `Are you sure you want to delete subcategory "${subcategory}" from "${category.name}"?`;
                        if (inUse) {
                           confirmMessage += `\n\nProducts currently in this subcategory will be moved to the "Default" subcategory of "${category.name}".`;
                        }
                        if (window.confirm(confirmMessage)) {
                          await onDeleteSubcategory(category.id, category.name, subcategory);
                        }
                      }}
                      className="btn btn-danger btn-xs"
                      disabled={(category.name === 'Uncategorized' && subcategory === 'Default') || (subcategory === 'Default' && category.subcategories.length === 1 && category.name !== 'Uncategorized')}
                      aria-label={`Delete subcategory ${subcategory} from ${category.name}`}
                    >
                      Delete Sub
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="no-subcategories-text">No subcategories defined for {category.name}. Add one above.</p>}
             {category.name !== 'Uncategorized' && !category.subcategories.includes('Default') && (
                <p className="no-subcategories-text" style={{marginTop: '0.5em', fontSize: '0.8em'}}>
                    Note: A "Default" subcategory will be automatically created if needed for product reassignment or if all other subcategories are deleted.
                </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

const App: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
    
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [viewMode, setViewMode] = useState<'admin' | 'stock'>('stock'); 
  const [selectedCategoryForView, setSelectedCategoryForView] = useState<string | null>(null);
  const [selectedSubcategoryForView, setSelectedSubcategoryForView] = useState<string | null>(null);

  const [initialItemsLoaded, setInitialItemsLoaded] = useState(false);
  const [initialCategoriesLoaded, setInitialCategoriesLoaded] = useState(false);

  const isHandlingPopStateRef = useRef(false);
  const isInitialHistoryRef = useRef(true);
  const historyIndexRef = useRef(0);
  const hasSeededHistoryRef = useRef(false);

  console.warn("IMPORTANT: This app uses Firebase Realtime Database without authentication. Ensure your RTDB security rules are set to allow public read/write for '/categories' and '/products'. This is for development/testing only and is insecure for production.");

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.error("Failed to set auth persistence. Falling back to default behavior.", error);
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const buildHistoryState = (index: number): AppHistoryState => ({
    __app: APP_HISTORY_KEY,
    viewMode,
    selectedCategoryForView,
    selectedSubcategoryForView,
    historyIndex: index,
  });

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as AppHistoryState | null;
      if (!state || state.__app !== APP_HISTORY_KEY) {
        return;
      }

      historyIndexRef.current = typeof state.historyIndex === 'number' ? state.historyIndex : 0;
      isHandlingPopStateRef.current = true;

      setViewMode(state.viewMode);
      if (state.viewMode === 'stock') {
        setSelectedCategoryForView(state.selectedCategoryForView);
        setSelectedSubcategoryForView(state.selectedSubcategoryForView);
      } else {
        setSelectedCategoryForView(null);
        setSelectedSubcategoryForView(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const currentState = window.history.state as AppHistoryState | null;

    if (isInitialHistoryRef.current) {
      const hasAppState = !!(currentState && currentState.__app === APP_HISTORY_KEY && typeof currentState.historyIndex === 'number');
      if (hasAppState) {
        historyIndexRef.current = currentState!.historyIndex;
      } else {
        historyIndexRef.current = 0;
      }
      window.history.replaceState(buildHistoryState(historyIndexRef.current), '');

      if (!hasSeededHistoryRef.current && (!hasAppState || historyIndexRef.current === 0)) {
        historyIndexRef.current += 1;
        window.history.pushState(buildHistoryState(historyIndexRef.current), '');
        hasSeededHistoryRef.current = true;
      } else if (!hasSeededHistoryRef.current) {
        hasSeededHistoryRef.current = true;
      }

      isInitialHistoryRef.current = false;
      return;
    }

    if (isHandlingPopStateRef.current) {
      isHandlingPopStateRef.current = false;
      window.history.replaceState(buildHistoryState(historyIndexRef.current), '');
      return;
    }

    historyIndexRef.current += 1;
    window.history.pushState(buildHistoryState(historyIndexRef.current), '');
  }, [viewMode, selectedCategoryForView, selectedSubcategoryForView]);

  // Fetch Categories from RTDB
  useEffect(() => {
    setInitialCategoriesLoaded(false);
    const categoriesNodeRef = dbRef(rtdb, 'categories');
    const unsubscribeCategories = onValue(categoriesNodeRef, (snapshot) => {
      const data = snapshot.val();
      const fetchedCategories: CategoryDefinition[] = [];
      if (data) {
        for (const key in data) {
          fetchedCategories.push({ id: key, ...data[key] });
        }
      }
      setCategories(fetchedCategories);
      setInitialCategoriesLoaded(true);
      console.log("Categories loaded/updated from RTDB. Count:", fetchedCategories.length);
      if (fetchedCategories.length === 0) {
        console.log("No categories found in RTDB. Admin can add them via the Admin Panel.");
      }
    }, (error: any) => {
      console.error("Error fetching categories from RTDB. Code:", error?.code, "Message:", error?.message, "Full error:", error);
      alert("Could not load categories from RTDB. Functionality may be limited. Check console for details and verify RTDB rules and connectivity. Ensure rules allow public read.");
      setInitialCategoriesLoaded(true); 
    });

    return () => unsubscribeCategories();
  }, []); // rtdb is stable

  // Fetch Items (Products) from RTDB, dependent on categories being loaded
  useEffect(() => {
    if (!initialCategoriesLoaded) {
      setItems([]);
      setInitialItemsLoaded(false); // Explicitly set to false if categories aren't loaded yet
      return;
    }
    
    setInitialItemsLoaded(false);
    const itemsNodeRef = dbRef(rtdb, 'products');
    const unsubscribeItems = onValue(itemsNodeRef, (snapshot) => {
      const data = snapshot.val();
      const fetchedItems: InventoryItem[] = [];
      if (data) {
        for (const key in data) {
          const itemData = data[key];
          fetchedItems.push({ 
            id: key, 
            ...itemData,
            sizes: itemData.sizes || SIZES.reduce((acc, s) => { acc[s] = 0; return acc; }, {} as Record<Size, number>)
          });
        }
      }
      setItems(fetchedItems);
      setInitialItemsLoaded(true);
      console.log("Inventory items loaded/updated from RTDB. Count:", fetchedItems.length);
      if (fetchedItems.length === 0) {
        console.log("No items found in RTDB. Admin can add them via the Admin Panel.");
      }
    }, (error: any) => {
      console.error("Error fetching items from RTDB. Code:", error?.code, "Message:", error?.message, "Full error:", error);
      alert("Could not load inventory items from RTDB. Functionality may be limited. Check console for details and verify RTDB rules and connectivity. Ensure rules allow public read.");
      setInitialItemsLoaded(true); 
    });

    return () => unsubscribeItems();
  }, [initialCategoriesLoaded]); // rtdb is stable

  const openModal = (item: InventoryItem | null = null) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingItem(null);
  }, []);

  const handleSaveItem = useCallback(async (itemToSave: InventoryItem) => {
    if (!itemToSave) {
       const dataError = "Item data is missing for save operation.";
       console.error("handleSaveItem error: ", dataError);
       alert(`Save failed: ${dataError}`);
       throw new Error(dataError);
    }

    let validatedCategory = itemToSave.category;
    let validatedSubcategory = itemToSave.subcategory;
    const updates: { [key: string]: any } = {}; 

    let categoryDef = categories.find(c => c.name === itemToSave.category);
    let uncategorizedCatDef = categories.find(c => c.name === 'Uncategorized');

    if (!categoryDef) {
        validatedCategory = 'Uncategorized';
        validatedSubcategory = 'Default';
        if (!uncategorizedCatDef) {
            try {
                const newUncatRef = push(dbRef(rtdb, 'categories'));
                if (newUncatRef.key) {
                     updates[`/categories/${newUncatRef.key}`] = { name: 'Uncategorized', subcategories: ['Default'] };
                     console.log("Scheduled creation of 'Uncategorized' category in RTDB.");
                } else {
                    throw new Error("Failed to generate key for new Uncategorized category.");
                }
            } catch (e: any) { 
                console.error("Failed to prepare 'Uncategorized' category creation in RTDB during item save. Error:", e);
                alert("Error: Could not prepare 'Uncategorized' category. Item save might fail or be incomplete. Check RTDB rules for public write access to /categories.");
                throw e; 
            }
        } else if (!uncategorizedCatDef.subcategories.includes('Default')) {
            updates[`/categories/${uncategorizedCatDef.id}/subcategories`] = [...new Set([...uncategorizedCatDef.subcategories, 'Default'])].sort();
            console.log("Scheduled update for 'Uncategorized' to include 'Default' subcategory.");
        }
    } else {
        const subcategoryExists = categoryDef.subcategories.includes(itemToSave.subcategory);
        if (!subcategoryExists) {
            validatedSubcategory = 'Default';
            if (!categoryDef.subcategories.includes('Default')) {
                updates[`/categories/${categoryDef.id}/subcategories`] = [...new Set([...categoryDef.subcategories, 'Default'])].sort();
                console.log(`Scheduled update for '${categoryDef.name}' to include 'Default' subcategory.`);
            }
        }
    }
    
    const finalItemData: Omit<InventoryItem, 'id'> = {
        name: itemToSave.name,
        sku: itemToSave.sku,
        category: validatedCategory,
        subcategory: validatedSubcategory,
        sizes: itemToSave.sizes,
        price: itemToSave.price,
        description: itemToSave.description,
        imageUrl: itemToSave.imageUrl?.trim() || '',
    };
    
    try {
      if (itemToSave.id) { 
        updates[`/products/${itemToSave.id}`] = finalItemData;
        console.log("Item update scheduled for RTDB:", itemToSave.id);
      } else { 
        const newItemRef = push(dbRef(rtdb, 'products'));
        if (newItemRef.key) {
            updates[`/products/${newItemRef.key}`] = finalItemData;
            console.log("New item add scheduled for RTDB with key:", newItemRef.key);
        } else {
            throw new Error("Failed to generate key for new product.");
        }
      }

      if(Object.keys(updates).length > 0) {
          await update(dbRef(rtdb), updates);
          console.log("Batch update to RTDB successful.");
      }
      closeModal();

    } catch (error: any) {
      console.error("Error saving item to RTDB. Code:", error?.code, "Message:", error?.message, "Full error object:", error);
      let message = "Failed to save item. Please try again.";
      if (error.message?.includes('NETWORK_REQUEST_FAILED') || error.message?.includes('Failed to fetch')) {
        message = "Failed to save item: Network connection issue. Check connection, RTDB status, and rules (ensure public write access).";
      } else if (error.message?.includes('PERMISSION_DENIED')) {
        message = "Failed to save item: Permission denied. Check RTDB security rules (ensure public write access).";
      } else if (error.message) {
        message = `Failed to save item: ${error.message}`;
      }
      alert(message);
      throw error; 
    }
  }, [closeModal, categories, rtdb]);

  const handleDeleteItem = async (itemId: string) => {
    if (!itemId) return;
    if (window.confirm('Are you sure you want to delete this item?')) {
      try {
        const itemNodeRef = dbRef(rtdb, `products/${itemId}`);
        await remove(itemNodeRef);
        alert("Item deleted successfully from RTDB.");
      } catch (error: any) {
        console.error("Error deleting item from RTDB. Code:", error?.code, "Message:", error?.message, "Full error:", error);
        let message = "Failed to delete item. Please try again.";
        if (error.message?.includes('NETWORK_REQUEST_FAILED') || error.message?.includes('Failed to fetch')) {
            message = "Failed to delete item: Network connection issue. Check connection and RTDB rules (ensure public write access).";
        } else if (error.message?.includes('PERMISSION_DENIED')) {
            message = "Failed to delete item: Permission denied. Check RTDB security rules (ensure public write access).";
        }
        alert(message);
      }
    }
  };

  const handleSellItemSize = useCallback(async (itemId: string, sizeToSell: Size) => {
    if (!itemId) return;

    const item = items.find(i => i.id === itemId);
    if (item) {
        const currentQuantity = item.sizes[sizeToSell] || 0;
        if (currentQuantity > 0) {
            const newQuantity = currentQuantity - 1;
            const itemSizeRef = dbRef(rtdb, `products/${itemId}/sizes/${sizeToSell}`);
            try {
                await set(itemSizeRef, newQuantity);
            } catch (error: any) {
                console.error("Error selling item size in RTDB. Code:", error?.code, "Message:", error?.message, "Full error:", error);
                let message = "Failed to update stock. Please try again.";
                 if (error.message?.includes('NETWORK_REQUEST_FAILED') || error.message?.includes('Failed to fetch')) {
                    message = "Failed to update stock: Network connection issue. Check connection and RTDB rules (ensure public write access).";
                } else if (error.message?.includes('PERMISSION_DENIED')) {
                    message = "Failed to update stock: Permission denied. Check RTDB rules (ensure public write access).";
                }
                alert(message);
            }
        }
    }
  }, [items, rtdb]);

  const filteredItemsForAdminTable = items.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const itemsForProductStockView = items.filter(item => 
    item.category === selectedCategoryForView && item.subcategory === selectedSubcategoryForView
  );

  const handleAdminLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loginEmail.trim() || !loginPassword) return;
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setLoginPassword('');
    } catch (error: any) {
      let message = 'Login failed. Please check your email and password.';
      const code = error?.code || '';
      if (code === 'auth/invalid-email') message = 'Invalid email address.';
      if (code === 'auth/invalid-credential') message = 'Invalid email or password.';
      if (code === 'auth/user-not-found') message = 'No user found for this email.';
      if (code === 'auth/wrong-password') message = 'Incorrect password.';
      if (code === 'auth/too-many-requests') message = 'Too many attempts. Please try again later.';
      setLoginError(message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setViewMode('stock');
      setSelectedCategoryForView(null);
      setSelectedSubcategoryForView(null);
      setIsModalOpen(false);
      setEditingItem(null);
      setLoginError(null);
      setLoginEmail('');
      setLoginPassword('');
    } catch (error: any) {
      console.error("Error during logout:", error);
      alert("Logout failed. Please try again.");
    }
  };

  const toggleViewMode = () => {
    setViewMode(prevMode => {
        const newMode = prevMode === 'admin' ? 'stock' : 'admin';
        if (newMode === 'stock') {
            setSelectedCategoryForView(null);
            setSelectedSubcategoryForView(null);
        }
        return newMode;
    });
  };

  const handleAddCategory = async (categoryName: string) => {
    if (categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase())) {
        alert("Category already exists.");
        return;
    }
    const newCategoryData = { name: categoryName, subcategories: ['Default'] };
    try {
        const newCategoryRef = push(dbRef(rtdb, 'categories'));
        await set(newCategoryRef, newCategoryData);
        alert(`Category "${categoryName}" added successfully to RTDB.`);
    } catch (error: any) {
        console.error("Error adding category to RTDB. Code:", error?.code, "Message:", error?.message, "Full error:", error);
        alert(`Failed to add category. ${error.message?.includes('PERMISSION_DENIED') ? 'Permission denied. Check RTDB rules (ensure public write access).' : 'Network issue or other error. Please try again.'}`);
    }
  };

const handleDeleteCategory = async (categoryId: string, categoryName: string) => {
    if (categoryName === 'Uncategorized' || !categoryId) return;

    try {
        const updates: { [key: string]: any } = {};
        
        const itemsToReassign = items.filter(item => item.category === categoryName);

        let uncategorizedCat = categories.find(c => c.name === 'Uncategorized');
        if (!uncategorizedCat) {
            console.log("'Uncategorized' category not found in local state, scheduling creation in RTDB for item reassignment.");
            const newUncatRefKey = push(child(dbRef(rtdb), 'categories')).key; 
            if (!newUncatRefKey) throw new Error("Failed to generate key for Uncategorized category in RTDB.");
            
            updates[`/categories/${newUncatRefKey}`] = { name: 'Uncategorized', subcategories: ['Default'] };
        } else if (!uncategorizedCat.subcategories.includes('Default')) {
             updates[`/categories/${uncategorizedCat.id}/subcategories`] = [...new Set([...uncategorizedCat.subcategories, 'Default'])].sort();
        }

        itemsToReassign.forEach(item => {
            updates[`/products/${item.id}/category`] = 'Uncategorized';
            updates[`/products/${item.id}/subcategory`] = 'Default';
        });
        
        updates[`/categories/${categoryId}`] = null; 

        await update(dbRef(rtdb), updates);
        alert(`Category "${categoryName}" deleted. Associated items (if any) moved to Uncategorized/Default.`);

        if (selectedCategoryForView === categoryName) {
            setSelectedCategoryForView(null);
            setSelectedSubcategoryForView(null);
        }
    } catch (error: any) {
        console.error("Error deleting category and reassigning items in RTDB. Code:", error?.code, "Message:", error?.message, "Full error:", error);
        alert(`Failed to delete category. ${error.message?.includes('PERMISSION_DENIED') ? 'Permission denied. Check RTDB rules (ensure public write access).' : 'Network issue or other error. Please try again.'}`);
    }
};


  const handleAddSubcategory = async (categoryId: string, categoryName: string, subcategoryName: string) => {
    if (!categoryId || categoryName === 'Uncategorized') {
        alert("Cannot add subcategories to 'Uncategorized' or an invalid category.");
        return;
    }
    const category = categories.find(cat => cat.id === categoryId);
    if (category) {
        if (category.subcategories.find(s => s.toLowerCase() === subcategoryName.toLowerCase())) {
            alert("Subcategory already exists in this category.");
            return;
        }
        const newSubcategories = [...new Set([...category.subcategories, subcategoryName])].sort();
        try {
            await set(dbRef(rtdb, `categories/${categoryId}/subcategories`), newSubcategories);
             alert(`Subcategory "${subcategoryName}" added to "${categoryName}" in RTDB.`);
        } catch (error: any)
        {
            console.error("Error adding subcategory to RTDB. Code:", error?.code, "Message:", error?.message, "Full error:", error);
            alert(`Failed to add subcategory. ${error.message?.includes('PERMISSION_DENIED') ? 'Permission denied. Check RTDB rules (ensure public write access).' : 'Network issue or other error. Please try again.'}`);
        }
    } else {
        alert("Parent category not found.");
    }
  };

const handleDeleteSubcategory = async (categoryId: string, categoryName: string, subcategoryName: string) => {
    if ((categoryName === 'Uncategorized' && subcategoryName === 'Default') || !categoryId) {
        return; 
    }
    const parentCategory = categories.find(c => c.id === categoryId);
    if (!parentCategory) {
        alert("Parent category not found.");
        return;
    }

    if (subcategoryName === 'Default' && parentCategory.subcategories.length === 1 && categoryName !== 'Uncategorized') {
        alert("Cannot delete the only 'Default' subcategory of a non-'Uncategorized' category. Add another subcategory first, or delete the parent category.");
        return;
    }
    
    try {
        const updates: { [key: string]: any } = {};
        
        let updatedSubcategories = parentCategory.subcategories.filter(sub => sub !== subcategoryName);
        
        const itemsToReassign = items.filter(item => item.category === categoryName && item.subcategory === subcategoryName);
        
        let targetSubcategory = 'Default'; 

        if (itemsToReassign.length > 0) {
            if (subcategoryName !== 'Default' && !updatedSubcategories.includes('Default')) {
                updatedSubcategories.push('Default');
                updatedSubcategories.sort(); 
            } else if (subcategoryName === 'Default' && updatedSubcategories.length === 0 && categoryName !== 'Uncategorized') {
                updatedSubcategories.push('Default');
            }
            itemsToReassign.forEach(item => {
                updates[`/products/${item.id}/subcategory`] = targetSubcategory;
            });
        }
        
        if (categoryName !== 'Uncategorized' && updatedSubcategories.length === 0) {
          updatedSubcategories.push('Default'); 
        }

        updates[`/categories/${categoryId}/subcategories`] = updatedSubcategories.length > 0 ? updatedSubcategories : null; 
         if (categoryName === 'Uncategorized' && updatedSubcategories.length === 0 && subcategoryName === 'Default') {
             updates[`/categories/${categoryId}/subcategories`] = ['Default'];
         }


        await update(dbRef(rtdb), updates);
        alert(`Subcategory "${subcategoryName}" deleted from "${categoryName}". Associated items (if any) moved to "Default" subcategory in RTDB.`);

        if (selectedCategoryForView === categoryName && selectedSubcategoryForView === subcategoryName) {
            setSelectedSubcategoryForView(null); 
        }
    } catch (error: any) {
        console.error("Error deleting subcategory in RTDB. Code:", error?.code, "Message:", error?.message, "Full error:", error);
        alert(`Failed to delete subcategory. ${error.message?.includes('PERMISSION_DENIED') ? 'Permission denied. Check RTDB rules (ensure public write access).' : 'Network issue or other error. Please try again.'}`);
    }
  };

  const handleSelectCategoryForView = (categoryName: string) => {
    setSelectedCategoryForView(categoryName);
    setSelectedSubcategoryForView(null);
  };
  
  const handleSelectSubcategoryForView = (categoryName: string, subcategoryName: string) => {
    setSelectedCategoryForView(categoryName); 
    setSelectedSubcategoryForView(subcategoryName);
  };

  const handleNavigateBackFromStockView = () => {
    if (historyIndexRef.current > 0) {
      window.history.back();
      return;
    }

    if (selectedSubcategoryForView) {
      setSelectedSubcategoryForView(null);
    } else if (selectedCategoryForView) {
      setSelectedCategoryForView(null);
    }
  };

  const getCategoryItemCount = useCallback((categoryName: string, subcategoryName: string): number => {
    return items.filter(item => item.category === categoryName && item.subcategory === subcategoryName).length;
  }, [items]);


  if (!isAuthReady) {
    return (
        <div className="loading-container">
            <p>Loading authentication status...</p>
        </div>
    );
  }

  if (!initialCategoriesLoaded || !initialItemsLoaded) {
    let statusParts: string[] = [];
    if (!initialCategoriesLoaded) statusParts.push("categories");
    if (!initialItemsLoaded) statusParts.push("inventory data");
    return (
        <div className="loading-container">
            <p>Loading {statusParts.join(" and ")} from Firebase Realtime Database...</p>
            <p style={{marginTop: '10px', fontSize: '0.9em', color: '#555'}}>
                (This may take a moment. If loading persists or you see errors, please ensure your Realtime Database is correctly set up,
                security rules allow public access, and your internet connection is stable.)
            </p>
        </div>
    ); 
  }

  const adminToggleLabel = viewMode === 'admin'
    ? 'View Product Stock'
    : (currentUser ? 'View Admin Panel' : 'Admin Login');
  const adminToggleAriaLabel = viewMode === 'admin'
    ? 'Switch to Product Stock View'
    : (currentUser ? 'Switch to Admin Panel View' : 'Open Admin Login');
  
  return (
    <div className="container">
      <header className="app-header">
        <h1>Armada Inventory Management</h1>
        <div className="header-controls">
          {viewMode === 'admin' && currentUser && (
            <input
              type="text"
              placeholder="Search by name or SKU..."
              className="search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search inventory items"
            />
          )}
          <button 
            onClick={toggleViewMode} 
            className="btn btn-info" 
            aria-label={adminToggleAriaLabel}
          >
            {adminToggleLabel}
          </button>
          {viewMode === 'admin' && currentUser && (
            <button onClick={() => openModal()} className="btn btn-primary" aria-label="Add new item">
              Add New Item
            </button>
          )}
          {currentUser && (
            <button onClick={handleLogout} className="btn btn-secondary" aria-label="Logout from admin">
              Logout
            </button>
          )}
        </div>
      </header>

      {viewMode === 'admin' && currentUser && isModalOpen && (
        <ItemModal
          item={editingItem}
          onClose={closeModal}
          onSave={handleSaveItem}
          categories={categories}
          editingItemId={editingItem?.id || null}
        />
      )}
      
      {viewMode === 'admin' ? (
        currentUser ? (
          <>
            <AdminCategoryManager
              categories={categories}
              onAddCategory={handleAddCategory}
              onDeleteCategory={handleDeleteCategory}
              onAddSubcategory={handleAddSubcategory}
              onDeleteSubcategory={handleDeleteSubcategory}
              items={items}
            />
            <main className="inventory-table-container">
              {!initialItemsLoaded && <div className="loading-container"><p>Loading items...</p></div>}
              {initialItemsLoaded && filteredItemsForAdminTable.length === 0 && !searchTerm && (
                 <div className="empty-state">
                   <h2>No items in inventory.</h2>
                   <p>Click "Add New Item" to get started.</p>
                 </div>
              )}
               {initialItemsLoaded && filteredItemsForAdminTable.length === 0 && searchTerm && (
                  <div className="empty-state">
                    <h2>No items match your search "{searchTerm}".</h2>
                    <p>Try a different search term or clear the search.</p>
                  </div>
              )}
              {initialItemsLoaded && filteredItemsForAdminTable.length > 0 && (
                <table className="inventory-table" aria-label="Inventory Items">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>SKU</th>
                      <th>Category</th>
                      <th>Subcategory</th>
                      <th>Total Quantity</th>
                      <th>Price</th>
                      <th>Description</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItemsForAdminTable.map(item => {
                      const totalQuantity = calculateTotalQuantity(item.sizes);
                      return (
                        <tr key={item.id}>
                          <td data-label="Name">{item.name}</td>
                          <td data-label="SKU">{item.sku}</td>
                          <td data-label="Category">{item.category}</td>
                          <td data-label="Subcategory">{item.subcategory}</td>
                          <td data-label="Total Quantity">{totalQuantity}</td>
                          <td data-label="Price">৳{item.price.toFixed(2)}</td>
                          <td data-label="Description">{item.description || '-'}</td>
                          <td data-label="Actions" className="actions-cell">
                            <button onClick={() => openModal(item)} className="btn btn-secondary btn-sm" aria-label={`Edit ${item.name}`}>Edit</button>
                            <button onClick={() => handleDeleteItem(item.id)} className="btn btn-danger btn-sm" aria-label={`Delete ${item.name}`}>Delete</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </main>
          </>
        ) : (
          <div className="login-container">
            <form className="login-form" onSubmit={handleAdminLogin} autoComplete="off">
              <h2>Admin Login</h2>
              {loginError && <div className="login-error-message">{loginError}</div>}
              <div className="form-group">
                <label htmlFor="loginEmail">Email</label>
                <input
                  type="email"
                  id="loginEmail"
                  name="loginEmail"
                  value={loginEmail}
                  onChange={(e) => {
                    setLoginEmail(e.target.value);
                    if (loginError) setLoginError(null);
                  }}
                  autoComplete="off"
                  required
                  disabled={isLoggingIn}
                />
              </div>
              <div className="form-group">
                <label htmlFor="loginPassword">Password</label>
                <input
                  type="password"
                  id="loginPassword"
                  name="loginPassword"
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    if (loginError) setLoginError(null);
                  }}
                  autoComplete="new-password"
                  required
                  disabled={isLoggingIn}
                />
              </div>
              <button type="submit" className="btn btn-primary btn-login" disabled={isLoggingIn}>
                {isLoggingIn ? 'Logging in...' : 'Login'}
              </button>
              <p className="auth-switch-message">
                Back to product stock?{' '}
                <button type="button" className="btn-link" onClick={() => setViewMode('stock')}>
                  View stock
                </button>
              </p>
            </form>
          </div>
        )
      ) : (
        <ProductStockView
          items={itemsForProductStockView}
          allCategories={categories}
          selectedCategoryName={selectedCategoryForView}
          selectedSubcategoryName={selectedSubcategoryForView}
          onSelectCategory={handleSelectCategoryForView}
          onSelectSubcategory={handleSelectSubcategoryForView}
          onNavigateBack={handleNavigateBackFromStockView}
          onSellItemSize={handleSellItemSize}
          getCategoryItemCount={getCategoryItemCount}
          isAdmin={!!currentUser}
        />
      )}
      <footer className="app-footer">
        <p>&copy; {new Date().getFullYear()} Inventory App. All rights reserved by Armada.</p>
      </footer>
    </div>
  );
};

interface ItemModalFormData {
  name: string;
  sku: string;
  category: string;
  subcategory: string;
  sizes: Record<Size, number>;
  price: number;
  description?: string;
  imageUrl?: string;
}

interface ItemModalProps {
  item: InventoryItem | null;
  onClose: () => void;
  onSave: (item: InventoryItem) => Promise<void>; 
  categories: CategoryDefinition[];
  editingItemId: string | null; 
}

const ItemModal: React.FC<ItemModalProps> = ({ item, onClose, onSave, categories, editingItemId }) => {
  
  const getInitialFormData = useCallback((): ItemModalFormData => {
    const defaultSizes = SIZES.reduce((acc, size) => { acc[size] = 0; return acc; }, {} as Record<Size, number>);
    
    let initialCategoryName = '';
    let initialSubcategoryName = '';

    const uncategorizedCategory = categories.find(c => c.name === 'Uncategorized');
    const firstAvailableCategory = categories.find(c => c.name !== 'Uncategorized') || categories[0];

    if (item) { 
      const currentItemCategory = categories.find(c => c.name === item.category);
      if (currentItemCategory) {
        initialCategoryName = currentItemCategory.name;
        initialSubcategoryName = currentItemCategory.subcategories.includes(item.subcategory)
          ? item.subcategory
          : (currentItemCategory.subcategories.includes('Default') ? 'Default' : (currentItemCategory.subcategories[0] || ''));
      } else { 
        if (uncategorizedCategory) {
          initialCategoryName = uncategorizedCategory.name;
          initialSubcategoryName = uncategorizedCategory.subcategories.includes('Default') ? 'Default' : (uncategorizedCategory.subcategories[0] || 'Default');
        } else if (firstAvailableCategory) {
          initialCategoryName = firstAvailableCategory.name;
          initialSubcategoryName = firstAvailableCategory.subcategories.includes('Default') ? 'Default' : (firstAvailableCategory.subcategories[0] || '');
        }
      }
      return {
        name: item.name,
        sku: item.sku,
        category: initialCategoryName,
        subcategory: initialSubcategoryName,
        sizes: SIZES.reduce((acc, size) => { acc[size] = Number(item.sizes?.[size]) || 0; return acc; }, {} as Record<Size, number>),
        price: item.price,
        description: item.description || '',
        imageUrl: item.imageUrl || '',
      };
    } else { // Adding new item
      if (categories.length > 0) {
        const preferredInitialCategory = categories.find(c => c.name !== 'Uncategorized') || uncategorizedCategory || categories[0];
        if (preferredInitialCategory) {
            initialCategoryName = preferredInitialCategory.name;
            initialSubcategoryName = preferredInitialCategory.subcategories.includes('Default') 
                ? 'Default' 
                : (preferredInitialCategory.subcategories[0] || '');
        }
      }
      return {
        name: '',
        sku: '',
        category: initialCategoryName,
        subcategory: initialSubcategoryName,
        sizes: defaultSizes,
        price: 0,
        description: '',
        imageUrl: '',
      };
    }
  }, [item, categories]);
  
  const [formData, setFormData] = useState<ItemModalFormData>(getInitialFormData());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  const availableSubcategories = categories.find(c => c.name === formData.category)?.subcategories || [];

  useEffect(() => {
    setFormData(getInitialFormData());
    setErrors({});
  }, [item, getInitialFormData]); 

  useEffect(() => {
    const currentCategoryDef = categories.find(c => c.name === formData.category);

    if (formData.category && currentCategoryDef) { 
        if (!currentCategoryDef.subcategories.includes(formData.subcategory)) { 
            setFormData(prev => ({
                ...prev,
                subcategory: currentCategoryDef.subcategories.includes('Default') 
                             ? 'Default' 
                             : (currentCategoryDef.subcategories[0] || '') 
            }));
        }
    } else if (formData.category && !currentCategoryDef && categories.length > 0) { 
        const defaultCat = categories.find(c => c.name === 'Uncategorized') || categories[0];
        if (defaultCat) { 
            setFormData(prev => ({
                ...prev,
                category: defaultCat.name,
                subcategory: defaultCat.subcategories.includes('Default') ? 'Default' : (defaultCat.subcategories[0] || '')
            }));
        } else { 
             setFormData(prev => ({ ...prev, category: '', subcategory: '' }));
        }
    } else if (categories.length === 0) { 
        setFormData(prev => ({ ...prev, category: '', subcategory: '' }));
    } else if (!formData.category && categories.length > 0) { 
        const preferredInitialCategory = categories.find(c => c.name !== 'Uncategorized') || categories.find(c => c.name === 'Uncategorized') || categories[0];
        if (preferredInitialCategory) {
            setFormData(prev => ({
                ...prev,
                category: preferredInitialCategory.name,
                subcategory: preferredInitialCategory.subcategories.includes('Default') 
                             ? 'Default' 
                             : (preferredInitialCategory.subcategories[0] || '')
            }));
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.category, categories]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let newErrors = { ...errors };

    if (name.startsWith('size_')) {
      const sizeKey = name.split('_')[1] as Size;
      setFormData(prev => ({
        ...prev,
        sizes: { ...prev.sizes, [sizeKey]: parseInt(value) || 0 }
      }));
      delete newErrors[name];
    } else if (name === 'category') {
      const newCategoryName = value;
      const categoryObj = categories.find(c => c.name === newCategoryName);
      const newSubcategory = categoryObj 
        ? (categoryObj.subcategories.includes('Default') ? 'Default' : (categoryObj.subcategories[0] || ''))
        : '';
      setFormData(prev => ({ ...prev, category: newCategoryName, subcategory: newSubcategory }));
      delete newErrors.category;
      delete newErrors.subcategory;
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'number' && name === 'price' ? parseFloat(value) || 0 : value,
      }));
      delete newErrors[name];
    }
    setErrors(newErrors);
  };
  
  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = 'Name is required.';
    if (!formData.sku.trim()) newErrors.sku = 'SKU is required.';
    
    if (!formData.category) {
        newErrors.category = 'Category is required. Please create one if none exist.';
    } else {
        const catDef = categories.find(c => c.name === formData.category);
        if (!catDef) {
            newErrors.category = 'Selected category is invalid or not loaded. Please re-select or manage categories.';
        } else if (!formData.subcategory) {
            newErrors.subcategory = 'Subcategory is required. Select or add a subcategory to the chosen category.';
        } else if (!catDef.subcategories.includes(formData.subcategory)) {
             newErrors.subcategory = `Subcategory '${formData.subcategory}' is not valid for category '${formData.category}'. Available: ${catDef.subcategories.join(', ') || 'None (add "Default" or another subcategory)'}. Please re-select or manage subcategories.`;
        }
    }

    if (formData.price < 0) newErrors.price = 'Price cannot be negative.';
    else if (isNaN(formData.price)) newErrors.price = 'Price must be a number.';
    
    SIZES.forEach(size => {
      const sizeQuantity = formData.sizes[size];
      if (sizeQuantity < 0) newErrors[`size_${size}`] = `Qty for ${size} cannot be negative.`;
      else if (isNaN(sizeQuantity)) newErrors[`size_${size}`] = `Qty for ${size} must be a number.`;
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const timeoutPromise = (ms: number, message: string = 'Operation timed out') => 
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(message)), ms)
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsProcessing(true);

    const itemDataForSave: InventoryItem = {
      id: editingItemId || '', 
      name: formData.name.trim(),
      sku: formData.sku.trim(),
      category: formData.category,
      subcategory: formData.subcategory,
      sizes: formData.sizes,
      price: Number(formData.price),
      description: formData.description?.trim() || '',
      imageUrl: formData.imageUrl?.trim() || '',
    };
    
    try {
        await Promise.race([
            onSave(itemDataForSave),
            timeoutPromise(30000, 'Saving item timed out. Realtime Database might be offline or experiencing issues. Ensure your RTDB is correctly set up and security rules allow writes.') 
        ]);
    } catch (error: any) {
        console.error("Error during onSave call or timeout in ItemModal (RTDB). Message:", error.message, "Full error object:", error);
        if (error.message && error.message.startsWith('Saving item timed out')) {
            alert(error.message); 
        }
    } finally {
        setIsProcessing(false);
    }
  };
  
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isProcessing) onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose, isProcessing]);


  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-content">
        <header className="modal-header">
          <h2 id="modal-title">{item ? 'Edit Item' : 'Add New Item'}</h2>
          <button onClick={onClose} className="btn-close" aria-label="Close modal" disabled={isProcessing}>&times;</button>
        </header>
        <form onSubmit={handleSubmit} noValidate>
          {/* Name */}
          <div className="form-group">
            <label htmlFor="name">Name</label>
            <input type="text" id="name" name="name" value={formData.name} onChange={handleChange} required aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} disabled={isProcessing} />
            {errors.name && <p id="name-error" className="error-message">{errors.name}</p>}
          </div>
          {/* SKU */}
          <div className="form-group">
            <label htmlFor="sku">SKU</label>
            <input type="text" id="sku" name="sku" value={formData.sku} onChange={handleChange} required aria-invalid={!!errors.sku} aria-describedby={errors.sku ? "sku-error" : undefined} disabled={isProcessing} />
            {errors.sku && <p id="sku-error" className="error-message">{errors.sku}</p>}
          </div>

          {/* Category */}
          <div className="form-group">
            <label htmlFor="category">Category</label>
            <select 
                id="category" 
                name="category" 
                value={formData.category} 
                onChange={handleChange} 
                required 
                aria-invalid={!!errors.category} 
                aria-describedby={errors.category ? "category-error" : undefined} 
                disabled={isProcessing || categories.length === 0}
            >
              {categories.length === 0 && <option value="">No categories available. Please add one in Admin Panel.</option>}
              {categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
            </select>
            {errors.category && <p id="category-error" className="error-message">{errors.category}</p>}
          </div>

          {/* Subcategory */}
          <div className="form-group">
            <label htmlFor="subcategory">Subcategory</label>
            <select 
                id="subcategory" 
                name="subcategory" 
                value={formData.subcategory} 
                onChange={handleChange} 
                required 
                disabled={isProcessing || !formData.category || availableSubcategories.length === 0}
                aria-invalid={!!errors.subcategory} 
                aria-describedby={errors.subcategory ? "subcategory-error" : undefined}
            >
              {!formData.category && <option value="">Select a category first</option>}
              {formData.category && availableSubcategories.length === 0 && <option value="">No subcategories. Add one in Admin Panel or 'Default' will be used.</option>}
              {availableSubcategories.map(sub => <option key={sub} value={sub}>{sub}</option>)}
            </select>
            {errors.subcategory && <p id="subcategory-error" className="error-message">{errors.subcategory}</p>}
          </div>
          
          {/* Sizes */}
          <fieldset className="form-group">
            <legend>Quantities by Size</legend>
            <div className="sizes-grid">
              {SIZES.map(size => (
                <div key={size} className="form-group-size">
                  <label htmlFor={`size_${size}`}>{size}</label>
                  <input type="number" id={`size_${size}`} name={`size_${size}`} value={formData.sizes[size]} onChange={handleChange} min="0" required aria-invalid={!!errors[`size_${size}`]} aria-describedby={errors[`size_${size}`] ? `size_${size}-error` : undefined} disabled={isProcessing}/>
                  {errors[`size_${size}`] && <p id={`size_${size}-error`} className="error-message error-message-size">{errors[`size_${size}`]}</p>}
                </div>
              ))}
            </div>
          </fieldset>

          {/* Price */}
          <div className="form-group">
            <label htmlFor="price">Price</label>
            <input type="number" id="price" name="price" value={formData.price} onChange={handleChange} min="0" step="0.01" required aria-invalid={!!errors.price} aria-describedby={errors.price ? "price-error" : undefined} disabled={isProcessing}/>
            {errors.price && <p id="price-error" className="error-message">{errors.price}</p>}
          </div>
          {/* Image URL */}
          <div className="form-group">
            <label htmlFor="imageUrl">Image URL (Optional)</label>
            <input
              type="text"
              id="imageUrl"
              name="imageUrl"
              value={formData.imageUrl || ''}
              onChange={handleChange}
              placeholder="https://example.com/image.jpg"
              disabled={isProcessing}
            />
          </div>
          {/* Description */}
          <div className="form-group">
            <label htmlFor="description">Description (Optional)</label>
            <textarea id="description" name="description" value={formData.description || ''} onChange={handleChange} rows={3} disabled={isProcessing}/>
          </div>
          {/* Actions */}
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isProcessing}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isProcessing}>
              {isProcessing ? 'Saving...' : (item ? 'Save Changes' : 'Add Item')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<React.StrictMode><App /></React.StrictMode>);
} else {
  console.error('Failed to find the root element');
}
