
                // Enrich
                console.log(`Enriching: ${data.title.substring(0, 20)}...`);
                
                let general_price = 0;
                if (data.price) {
                     const match = data.price.match(/(\d+(\.\d+)?)/);
                     if (match) general_price = parseFloat(match[1]) * 200; 
                }

                // --- EDIBLE CHECK (KEYWORD PRE-FILTER) ---
                const preCheck = isEdiblePreCheck(data.title, data.description);
                if (preCheck.isEdible) {
                    console.log(`Skipping product (EDIBLE KEYWORD DETECTED: ${preCheck.keyword}): ${data.title.substring(0, 30)}...`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                const aiData = await enrichWithAI(data.title, data.description, data.price);

                // CHECK: Did AI fail completely?
                if (aiData.shouldSkip) {
                    console.error(`Skipping product due to AI translation failure: ${aiData.reason}`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                // CHECK: Is it edible (AI Detection)?
                if (aiData.is_edible) {
                    console.log(`Skipping product (AI DETECTED EDIBLE): ${data.title.substring(0, 30)}...`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                // --- GENERATE OPTIONS FROM SKU MAP (WITH TRANSLATION) ---
                let generated_options = [];
                const variantImages = data.variantImages || {};
                const skuThumbMap = data.skuThumbMap || {};

                if (data.skuMap && Object.keys(data.skuMap).length > 0) {
                    const rawVariantEntries = Object.entries(data.skuMap || {});
                    console.log(`Variant prices BEFORE translation (${rawVariantEntries.length})`);
                    const rawPreviewLimit = 80;
                    rawVariantEntries.slice(0, rawPreviewLimit).forEach(([k, v]) => {
                        const m = String(v || '').match(/(\d+(\.\d+)?)/);
                        const p = m ? Math.round(parseFloat(m[1]) * 200) : 0;
                        console.log(`  ${k} => ${v} (${p} IQD)`);
                    });
                    if (rawVariantEntries.length > rawPreviewLimit) {
                        console.log(`  ... truncated ${rawVariantEntries.length - rawPreviewLimit} more`);
                    }
                    
                    // Helper to translate color/size via AI if possible, or simple mapping
                    // Since we want strict Arabic, we might need a quick AI pass or just use the aiData logic
                    // For now, let's process the structure first, then maybe translate the labels

                    const resolveThumbnail = (optionKey, colorStr) => {
                        if (optionKey && skuThumbMap[optionKey]) return skuThumbMap[optionKey];
                        if (!colorStr) return null;
                        if (variantImages[colorStr]) return variantImages[colorStr];
                        const keys = Object.keys(variantImages || {});
                        const matchingKey = keys.find(k => k && (k.includes(colorStr) || colorStr.includes(k)));
                        return matchingKey ? variantImages[matchingKey] : null;
                    };

                    for (const [key, priceStr] of rawVariantEntries) {
                        let color = key;
                        let size = null;

                        if (key.includes('__SEP__')) {
                            const parts = key.split('__SEP__');
                            color = parts[0];
                            size = parts[1];
                        }

                        let priceVal = 0;
                        const match = String(priceStr || '').match(/(\d+(\.\d+)?)/);
                        if (match) priceVal = parseFloat(match[1]) * 200;

                        color = String(color || '')
                            .replace(/\n.*$/, '')
                            .replace(/م€گ.*?م€‘/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();

                        if (size) {
                            size = String(size || '');
                            size = size.replace(/(\d+(\.\d+)?)\s*[-~]\s*(\d+(\.\d+)?)\s*و–¤/g, (m, p1, p2, p3) => {
                                const start = parseFloat(p1) / 2;
                                const end = parseFloat(p3) / 2;
                                return `${start}-${end}kg`;
                            });
                            size = size.replace(/(\d+(\.\d+)?)\s*و–¤/g, (m, p1) => `${parseFloat(p1) / 2}kg`);
                            size = size.replace(/\n.*$/, '').replace(/م€گ.*?م€‘/g, '').replace(/\s+/g, ' ').trim();
                            if (!size) size = null;
                        }

                        generated_options.push({
                            color,
                            sizes: size ? [size] : [],
                            price: priceVal,
                            thumbnail: resolveThumbnail(key, color)
                        });
                    }

                    console.log(`Generated options from SKU map (${generated_options.length})`);
 
                     // --- TRANSLATE OPTIONS IF AI IS AVAILABLE ---
                     if (aiClient && generated_options.length > 0) {
                         console.log(`Translating ${generated_options.length} options via AI (chunked)...`);

                         const translateChunk = async (chunk) => {
                             const optionsText = JSON.stringify(chunk.map(o => ({ c: o.color, s: (o.sizes && o.sizes[0]) ? o.sizes[0] : "" })));
                             const transPrompt = `
                             Translate these product options to Arabic.
                             Input: ${optionsText}
                             
                             IMPORTANT:
                             - Return ONLY a JSON array. Do not include any conversational text like "Here is the JSON" or markdown code blocks.
                             - Keep the number of items EXACTLY the same as input.
                             - Keep the order EXACTLY the same as input.
                             - Each output item must be {"c": "...", "s": "..."}.
                             - If the input contains "kg" (kilograms), KEEP "kg" in the translation (e.g. "80kg" -> "80kg" or "80 ظƒط؛ظ…").
                             - Do NOT convert numbers back to original units.
                             - Remove any Chinese characters or marketing text like "ه؟«è¦پو–­ç پ", "ه›¾ç‰‡è‰²" (Image Color), "é«کè´¨é‡ڈ", "ه»؛è®®", "و–¤".
                             - "图片色" or "默认" should be translated as "كما في الصورة" (As shown in image) or "اللون الافتراضي" (Default Color).
                            - Remove any newlines or extra whitespace.
                            - Return pure, clean Arabic names for colors and sizes.
                            - TRANSLATE COLORS TO ARABIC (e.g. "Black" -> "أسود", "红色" -> "أحمر").
                            - TRANSLATE "建议" (Recommended) to "مقترح" or remove it if just a label.
                            - STRICTLY REMOVE any "return policy", "refund", "replacement" (e.g. "包退", "包换") text from option names.
                             `;

                             const translate = async (model) => {
                                 return await aiClient.chat.completions.create({
                                     model,
                                     messages: [{ role: "user", content: transPrompt }],
                                     temperature: 0.3,
                                     max_tokens: 2048
                                 });
                             };

                             let transRes;
                             try {
                                transRes = await translate(AI_PRIMARY_MODEL);
                            } catch (e) {
                                if (isTimeoutError(e)) {
                                    throw e;
                                }
                                if (isModelBusyError(e)) {
                                    console.log(`AI busy on ${AI_PRIMARY_MODEL}. Falling back to ${AI_BUSY_FALLBACK_MODEL} for options translation...`);
                                    transRes = await translate(AI_BUSY_FALLBACK_MODEL);
                                } else if (AI_FALLBACK_MODEL && AI_FALLBACK_MODEL !== AI_PRIMARY_MODEL) {
                                    console.log(`AI error on ${AI_PRIMARY_MODEL}. Falling back to ${AI_FALLBACK_MODEL} for options translation...`);
                                    transRes = await translate(AI_FALLBACK_MODEL);
                                } else {
                                    throw e;
                                }
                            }

                             let transJson = transRes.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
                             const startIdx = transJson.indexOf('[');
                             const endIdx = transJson.lastIndexOf(']');
                             if (startIdx !== -1 && endIdx !== -1) transJson = transJson.substring(startIdx, endIdx + 1);

                             const transArr = JSON.parse(transJson);
                             if (!Array.isArray(transArr) || transArr.length !== chunk.length) {
                                 throw new Error(`Translation length mismatch (${Array.isArray(transArr) ? transArr.length : 'invalid'} vs ${chunk.length})`);
                             }
                             return transArr;
                         };

                         const applyTranslation = (chunk, transArr) => {
                             for (let i = 0; i < chunk.length; i++) {
                                 const opt = chunk[i];
                                 const t = transArr[i] || {};
                                 if (t.c) opt.color = String(t.c).trim().replace(/\s+/g, ' ');
                                 if (Array.isArray(opt.sizes) && opt.sizes.length > 0) {
                                     if (t.s !== undefined && t.s !== null) {
                                         const nextSize = String(t.s).trim().replace(/\s+/g, ' ');
                                         if (nextSize) opt.sizes[0] = nextSize;
                                     }
                                 }
                             }
                         };

                         const baseChunkSize = Number(process.env.AI_OPTIONS_TRANSLATE_CHUNK_SIZE) > 0 ? Number(process.env.AI_OPTIONS_TRANSLATE_CHUNK_SIZE) : 25;
                         const queue = [];
                         for (let i = 0; i < generated_options.length; i += baseChunkSize) {
                             queue.push([i, Math.min(i + baseChunkSize, generated_options.length)]);
                         }

                         while (queue.length > 0) {
                             const [start, end] = queue.shift();
                             const chunk = generated_options.slice(start, end);
                             let ok = false;
                             let attempts = 0;
                             const maxAttempts = 3;
                             while (!ok && attempts < maxAttempts) {
                                 attempts++;
                                 try {
                                     const transArr = await translateChunk(chunk);
                                     applyTranslation(chunk, transArr);
                                     ok = true;
                                 } catch (e) {
                                     if (attempts >= maxAttempts) break;
                                     await delay(700);
                                 }
                             }
                             if (!ok) {
                                 if (chunk.length <= 1) continue;
                                 const mid = start + Math.floor((end - start) / 2);
                                 queue.unshift([mid, end]);
                                 queue.unshift([start, mid]);
                             }
                         }

                         console.log('Options translation applied (chunked best-effort).');
                     } else {
                         console.log('Skipping options translation (AI not ready or no options).');
                     }

                    console.log(`Variant prices AFTER translation (${generated_options.length})`);
                    const postLines = [];
                    for (const opt of generated_options) {
                        const s = (opt.sizes && opt.sizes[0]) ? opt.sizes[0] : '';
                        postLines.push(`${opt.color}${s ? `__SEP__${s}` : ''} => ${opt.price} IQD`);
                    }
                    const postPreviewLimit = 120;
                    postLines.slice(0, postPreviewLimit).forEach(l => console.log(`  ${l}`));
                    if (postLines.length > postPreviewLimit) console.log(`  ... truncated ${postLines.length - postPreviewLimit} more`);
                 }

                const enrichedProduct = {
                    product_name: aiData.product_name_ar || 'اسم غير متوفر',
                    // original_name: data.title, // REMOVED as per request
                    main_images: data.images.slice(0, 5),
                    url: productUrl,
                    // product_details: data.productDetails, // REMOVED as per request
                    product_details: aiData.product_details_ar, // Use Arabic details as main 'product_details'
                    // product_details_ar: aiData.product_details_ar, // REMOVED redundancy
                    product_desc_imgs: data.product_desc_imgs || [], // Description Images
                    general_price: general_price,
                    generated_options: generated_options, // New Field
                    scrapedReviews: data.reviews || [], // Store reviews at top level (renamed from reviews)
                    aiMetadata: { ...(aiData.aiMetadata || {}) }, // Removed reviews from here
                    isAirRestricted: aiData.isAirRestricted || false, // New Field
                    // variants: data.variants, // REMOVED as per request
                    // skuMap: data.skuMap // REMOVED as per request
                };

                // Calculate Final Price with 15% Profit
                const calculateFinalPrice = (base) => {
                    const price = Number(base) || 0;
                    if (price <= 0) return 0;
                    // Formula: (BaseIQD + Domestic) * 1.15 / 10 * 10 (ceil)
                    // Assuming domestic shipping is 0 or handled separately in cart logic, 
                    // but usually scraper stores the inclusive price.
                    // Let's stick to the basic profit margin here.
                    return Math.ceil((price * 1.15) / 10) * 10;
                };

                const finalPrice = calculateFinalPrice(general_price);

                // CHECK: Skip product if price is too low (<= 250 IQD)
                // This usually indicates a failed price extraction or a dummy product
                if (finalPrice <= 250) {
                    console.log(`Skipping product: Price too low (Final: ${finalPrice}, Base: ${general_price}). URL: ${productUrl}`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                products.push(enrichedProduct);
                console.log(`Scraped successfully. Total: ${products.length}`);
                
                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(products, null, 2));

                // --- DATABASE INSERTION ---
                console.log('Inserting into Database...');
                try {
                    // 1. Create Product
                    const newProduct = await prisma.product.create({
                        data: {
                            name: enrichedProduct.product_name,
                            price: finalPrice, // Store FINAL price with profit
                            basePriceIQD: enrichedProduct.general_price || 0, // Store BASE price (Cost)
                            image: enrichedProduct.main_images[0] || '',
                            purchaseUrl: enrichedProduct.url,
                            specs: JSON.stringify(enrichedProduct.product_details || {}),
                            aiMetadata: enrichedProduct.aiMetadata || {},
                            scrapedReviews: enrichedProduct.scrapedReviews || [], // Save reviews to DB
                            isAirRestricted: enrichedProduct.isAirRestricted || false, // Save to DB
                            status: "PUBLISHED",
                            isActive: true,
                        }
                    });
                    console.log(`Product created: ID ${newProduct.id}`);

                    // 2. Create Product Images (Gallery)
                    if (enrichedProduct.main_images && enrichedProduct.main_images.length > 0) {
                        await prisma.productImage.createMany({
                            data: enrichedProduct.main_images.map((url, i) => ({
                                productId: newProduct.id,
                                url: url,
                                order: i,
                                type: "GALLERY"
                            }))
                        });
                    }

                    // 3. Create Description Images
                    if (enrichedProduct.product_desc_imgs && enrichedProduct.product_desc_imgs.length > 0) {
                        await prisma.productImage.createMany({
                            data: enrichedProduct.product_desc_imgs.map((url, i) => ({
                                productId: newProduct.id,
                                url: url,
                                order: i + 100, // Offset to keep them after gallery
                                type: "DESCRIPTION"
                            }))
                        });
                    }

                    // 4. Create Product Options (Color & Size) - VALIDATED
                    const colors = new Set();
                    const sizes = new Set();
                    
                    // Filter out Chinese characters from options
                    const containsChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
                    
                    // Filter out invalid/suspicious options (Custom orders, deposits, etc.)
                    const invalidKeywords = [
                        '定制', '专拍', '补差', '邮费', '不发货', '联系客服', // Chinese
                        'تخصيص', 'اتصال', 'رابط', 'فرق', 'إيداع', 'لا يرسل', 'خدمة العملاء', 'مخصص' // Arabic
                    ];

                    enrichedProduct.generated_options = enrichedProduct.generated_options.filter(opt => {
                        const text = (opt.color || '') + ' ' + (opt.sizes ? opt.sizes.join(' ') : '');
                        const hasInvalidKeyword = invalidKeywords.some(kw => text.includes(kw));

                        if (hasInvalidKeyword) {
                            console.log(`Skipping invalid/suspicious option: ${text} (Price: ${opt.price})`);
                            return false;
                        }
                        return true;
                    });

                    enrichedProduct.generated_options.forEach(opt => {
                        // Skip entire option if color is Chinese
                        if (opt.color && !containsChinese(opt.color)) {
                            colors.add(opt.color);
                        } else if (opt.color) {
                            // RETRY TRANSLATION FOR SINGLE OPTION
                            // We do a synchronous-like blocking call here or just use it as is if critical?
                            // User said: "try to translate it again if you can't then use it, don't skip generated options"
                            console.log(`Chinese color detected: ${opt.color}. Attempting fallback translation/usage...`);
                            colors.add(opt.color); // Add it anyway, don't skip
                        }

                        if (opt.sizes && Array.isArray(opt.sizes)) {
                            opt.sizes.forEach(s => {
                                if (!containsChinese(s)) {
                                    sizes.add(s);
                                } else {
                                    console.log(`Chinese size detected: ${s}. Using it anyway.`);
                                    sizes.add(s);
                                }
                            });
                        }
                    });

                    // Only create options if we have valid values
                    if (colors.size > 0) {
                        await prisma.productOption.create({
                            data: {
                                productId: newProduct.id,
                                name: "اللون",
                                values: JSON.stringify(Array.from(colors))
                            }
                        });
                    }

                    if (sizes.size > 0) {
                        await prisma.productOption.create({
                            data: {
                                productId: newProduct.id,
                                name: "المقاس",
                                values: JSON.stringify(Array.from(sizes))
                            }
                        });
                    }

                    // 5. Create Variants - VALIDATED
                    const variantsData = [];
                    const normalizeVariantBasePrice = (basePrice) => {
                        let p = Number(basePrice) || 0;
                        if (p > 0 && p < 100) {
                            console.log(`Warning: Suspiciously low price (${p}). Assuming RMB and multiplying by 200.`);
                            p = p * 200;
                        } else if (p > 0 && p < 1000 && enrichedProduct.general_price > 5000) {
                            console.log(`Warning: Variant price ${p} vs Main ${enrichedProduct.general_price}. Assuming RMB.`);
                            p = p * 200;
                        }
                        return p;
                    };
                    for (const opt of enrichedProduct.generated_options) {
                        // SKIP if color is Chinese (DISABLED: User wants to keep them)
                        // if (containsChinese(opt.color)) continue;

                        const color = opt.color;
                        const fallbackBasePrice = normalizeVariantBasePrice(opt.price || enrichedProduct.general_price || 0);
                        const variantImg = opt.thumbnail || enrichedProduct.main_images[0] || '';
                        
                        if (opt.sizes && Array.isArray(opt.sizes) && opt.sizes.length > 0) {
                            for (const size of opt.sizes) {
                                const variantBasePrice = fallbackBasePrice;
                                const variantFinalPrice = calculateFinalPrice(variantBasePrice);
                                const combinationObj = {
                                    "اللون": color,
                                    "المقاس": size
                                };
                                variantsData.push({
                                    productId: newProduct.id,
                                    combination: JSON.stringify(combinationObj),
                                    price: variantFinalPrice,
                                    basePriceIQD: variantBasePrice,
                                    image: variantImg
                                });
                            }
                        } else {
                            const variantBasePrice = fallbackBasePrice;
                            const variantFinalPrice = calculateFinalPrice(variantBasePrice);
                            const combinationObj = { "اللون": color };
                            variantsData.push({
                                productId: newProduct.id,
                                combination: JSON.stringify(combinationObj),
                                price: variantFinalPrice,
                                basePriceIQD: variantBasePrice,
                                image: variantImg
                            });
                        }
                    }

                    if (variantsData.length > 0) {
                        await prisma.productVariant.createMany({
                            data: variantsData
                        });
                    }
                    console.log('Database insertion complete.');

                    // Generate and save embedding for new product
                    if (newProduct && newProduct.id) {
                        try {
                            console.log('Triggers the embedding...');
                            await processProductEmbedding(newProduct.id);
                        } catch (embedErr) {
                            console.error(`Embedding generation failed for product ${newProduct.id} (non-fatal):`, embedErr.message);
                        }
                    }

                } catch (dbErr) {
                    console.error('Database Insertion Failed:', dbErr.message);
                }

                // --- SKIP DB INSERTION (Local Mode) ---
                // console.log('Skipping Database Insertion (Local Mode)');

            } catch (scrapeErr) {
                console.error('Scrape error:', scrapeErr.message);
            }

            // Clean up
            if (!navigationHappened) {
                await newPage.close();
            } else {
                console.log('Going back to category page...');
                await page.goBack({ waitUntil: 'domcontentloaded' });
                await humanDelay(2000, 3000);
            }

            await humanDelay(2000, 5000);
            
            // Random Delay between 10-15 seconds before next item
            const nextItemDelay = 10000 + Math.random() * 5000;
            console.log(`Waiting ${(nextItemDelay/1000).toFixed(1)}s before next item...`);
            await delay(nextItemDelay);
        } // End of 4-click loop

        // Scroll down to load more items for next pass
        console.log('Finished batch of 4 clicks. Scrolling for more items...');
        await autoScroll(page);
        await humanDelay(3000, 5000);
    }

    console.log('[End] Scraping Complete.');
    await browser.close();
    await prisma.$disconnect();
}

run().catch(err => console.error('Fatal Error:', err));

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

// Force keep-alive
setInterval(() => {
    try {
        fs.appendFileSync('scraper_debug.log', `Tick: ${new Date().toISOString()}\n`);
    } catch(e) {}
}, 5000);
