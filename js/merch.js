/* Module: merch — extracted from app.js */
/* Merch/Fourthwall tab logic: merch card rendering, product field updates, manual store scrape trigger */

        // -------------------------------------------------------------
        // FOURTHWALL MERCH SHOP & ROTATORS
        // -------------------------------------------------------------
        
        async function renderMerchCards() {
            const scrapedContainer = document.getElementById('scraped-merch-container');
            const overrideContainer = document.getElementById('override-merch-container');
            
            scrapedContainer.innerHTML = '';
            overrideContainer.innerHTML = '';

            const products = await api.fetchProducts(activeShowId);
            
            products.forEach(p => {
                const card = document.createElement('div');
                card.className = `merch-pool-card ${p.is_evergreen ? 'evergreen' : ''}`;
                
                card.innerHTML = `
                    <div class="m-index">Slot Index ${p.slot_index}</div>
                    <div class="m-body">
                        <div class="form-group-sm">
                            <label>Product Title</label>
                            <input type="text" value="${escapeHtml(p.title)}" onchange="updateProductField('${p.product_id}', 'title', this.value)">
                        </div>
                        <div class="form-group-sm">
                            <label>Price</label>
                            <input type="text" value="${escapeHtml(p.price)}" onchange="updateProductField('${p.product_id}', 'price', this.value)">
                        </div>
                        <div class="form-group-sm">
                            <label>Checkout Link</label>
                            <input type="text" value="${escapeHtml(p.checkout_url)}" onchange="updateProductField('${p.product_id}', 'checkout_url', this.value)">
                        </div>
                    </div>
                `;
                
                if (p.slot_index >= 5) {
                    overrideContainer.appendChild(card);
                } else {
                    scrapedContainer.appendChild(card);
                }
            });
        }

        async function updateProductField(prodId, field, value) {
            const products = await api.fetchProducts(activeShowId);
            const p = products.find(prod => prod.product_id === prodId);
            if (p) {
                p[field] = value;
                await api.saveProduct(activeShowId, p);
                renderMerchCards();
                
                // Refresh overlay hot update
                refreshState();
            }
        }

        async function triggerManualStoreScrape() {
            const user = document.getElementById('fw-username-input').value.trim();
            const pass = document.getElementById('fw-password-input').value;
            
            // Display loading indicators
            showToast('🔄 Store scrape initiated...', 'success');
            
            const res = await api.triggerScrape(activeShowId, { username: user, password: pass });
            if (res.success) {
                showToast('✓ Scrape complete — items stored', 'success');
                refreshState();
            } else {
                showToast('✕ Scrape request failed', 'error');
            }
        }
