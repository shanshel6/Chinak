                    // STOPPING ACTIONS AS REQUESTED
                    console.log('[Reviews] Stopping all previous actions and stabilizing page before review scraping...');
                    await wait(2000);

                    let hasReviews = false;
                    try {
                        console.log(`[Reviews] Checking for reviews (商品评价)...`);
                        let reviewBtn = null;
                        try {
                            const xpath = "//*[contains(text(), '商品评价')]";
                            const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                            for (let i = 0; i < result.snapshotLength; i++) {
                                const el = result.snapshotItem(i);
                                if (el.textContent && el.textContent.length < 20) {
                                     if (el.innerText && el.innerText.includes('商品评价')) {
                                         reviewBtn = el;
                                         break;
                                     }
                                }
                            }
                        } catch(e) {}

                        if (!reviewBtn) {
                            const allElements = Array.from(document.querySelectorAll('div, span, p'));
                            reviewBtn = allElements.find(el => el.innerText && el.innerText.includes('商品评价') && el.innerText.length < 20);
                        }

                        if (reviewBtn) {
                            console.log(`[Reviews] Found review button, clicking...`);
                            reviewBtn.click();
                            hasReviews = true;
                        } else {
                            console.log('[Reviews] No review button found.');
                        }
                    } catch (e) {
                        console.log(`[Reviews] Error checking reviews: ${e.message}`);
                    }

                    return { title, price, description, images: [...new Set(images)], variants, skuMap, skuThumbMap, productDetails, variantImages, hasReviews };
                }, [], 12);

                // --- PART 2: REVIEWS (Separate Context) ---
                let reviews = [];
                if (data.hasReviews) {
                     console.log('[Reviews] Button clicked in previous step. Waiting 5s for page load (Node.js wait)...');
                     await new Promise(r => setTimeout(r, 5000));
                     
                     console.log('[Reviews] Starting review extraction (New Context)...');
                     reviews = await safeEvaluate(newPage, async () => {
                         const wait = (ms) => new Promise(r => setTimeout(r, ms));
                         const extractedReviews = [];
                         try {
                             // Scroll Logic
                             const reviewContent = document.querySelector('.comment-item') || document.querySelector('img[src*="avatar"]'); 
                             if (!reviewContent) {
                                 console.log('[Reviews] Review content not immediately visible, waiting...');
                                 await wait(2000);
                             }

                             console.log('[Reviews] Starting scroll sequence...');
                             for (let i = 0; i < 4; i++) {
                                 window.scrollBy(0, window.innerHeight);
                                 await wait(800 + Math.random() * 400);
                             }
                             
                             console.log('[Reviews] Extracting reviews...');
                             // Strategy: Group elements by class name to find review items
                             const divs = Array.from(document.querySelectorAll('div'));
                             const classCounts = {};
                             divs.forEach(d => {
                                 if (d.className && typeof d.className === 'string') {
                                     const c = d.className;
                                     if (!classCounts[c]) classCounts[c] = [];
                                     classCounts[c].push(d);
                                 }
                             });
                             
                             let bestClass = null;
                             let maxCount = 0;
                             for (const [cls, items] of Object.entries(classCounts)) {
                                 if (items.length > 1) {
                                     const first = items[0];
                                     const text = first.innerText.trim();
                                     const imgs = first.querySelectorAll('img');
                                     const hasValidImg = Array.from(imgs).some(img => img.naturalWidth > 50 && !img.src.includes('avatar'));
                                     if (text.length > 5 && hasValidImg) {
                                         if (items.length > maxCount) { maxCount = items.length; bestClass = cls; }
                                     }
                                 }
                             }

                             if (bestClass) {
                                 const items = classCounts[bestClass];
                                 items.forEach(item => {
                                     const text = item.innerText.trim();
                                     const imgs = Array.from(item.querySelectorAll('img')).filter(img => img.naturalWidth > 50 && !img.src.includes('avatar')).map(img => img.src.split('?')[0]);
                                     if (text && imgs.length > 0) {
                                         const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                                         let name = 'Pinduoduo Shopper';
                                         let comment = text;
                                         if (lines.length > 1 && lines[0].length < 20) { name = lines[0]; comment = lines.slice(1).join(' '); }
                                         extractedReviews.push({ name, comment, photos: [...new Set(imgs)] });
                                     }
                                 });
                             } else {
                                 const visibleImgs = Array.from(document.querySelectorAll('img')).filter(img => img.naturalWidth > 100 && !img.src.includes('avatar')).map(img => img.src.split('?')[0]);
                                 const uniqueImgs = [...new Set(visibleImgs)];
                                 for (let i = 0; i < uniqueImgs.length; i += 3) {
                                     extractedReviews.push({ name: 'Pinduoduo Shopper', comment: 'صور من تقييمات العملاء', photos: uniqueImgs.slice(i, i+3) });
                                 }
                             }

                             console.log(`[Reviews] Extracted ${extractedReviews.length} reviews.`);

                             // Go Back
                             console.log('[Reviews] Going back...');
                             const backBtn = document.querySelector('div[role="button"][aria-label*="返回"]') || document.querySelector('[data-testid="back-button"]');
                             if (backBtn) backBtn.click();
                             else window.history.back();
                             
                         } catch (e) { console.log('Review error:', e.message); }
                         return extractedReviews;
                     });
                     
                     console.log(`[Reviews] Extracted ${reviews.length} reviews. Waiting 2s for back navigation...`);
                     await new Promise(r => setTimeout(r, 2000));
                }
                data.reviews = reviews;

                // --- PART 3: DESCRIPTION IMAGES (Separate Context) ---
                console.log('[Description] Starting description image extraction (New Context)...');
                const product_desc_imgs = await safeEvaluate(newPage, async () => {
                     const wait = (ms) => new Promise(r => setTimeout(r, ms));
                     const imgs = [];
                     
                     // Scroll
                     console.log('[Description] Scrolling...');
                     const steps = 20;
                     const stepSize = document.body.scrollHeight / steps;
                     for (let i = 0; i < steps; i++) {
                         window.scrollBy(0, stepSize);
                         await wait(100);
                     }
                     await wait(2000);

                     // Extract
                     const allImgs = Array.from(document.querySelectorAll('img'));
                     allImgs.forEach(img => {
                         let src = img.getAttribute('data-src') || img.src;
                         if (src && !src.startsWith('data:') && img.naturalWidth > 300) {
                             if (!src.includes('avatar') && !src.includes('icon')) {
                                 imgs.push(src.split('?')[0]);
                             }
                         }
                     });
                     return [...new Set(imgs)];
                });
                data.product_desc_imgs = product_desc_imgs;
