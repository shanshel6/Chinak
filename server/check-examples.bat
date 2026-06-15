@echo off
REM ============================================
REM Check Example Products
REM ============================================
REM Check specific products mentioned by user
REM ============================================

echo.
echo ============================================
echo   Checking Example Products
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ ERROR: Node.js is not installed!
    pause
    exit /b 1
)

echo 📋 Checking products: 228365 and 114979
echo.

REM Create a simple Node.js script to check these products
echo var prisma = require('./prismaClient.js'); > temp-check.js
echo. >> temp-check.js
echo async function checkProducts() { >> temp-check.js
echo   console.log('Checking specific products...\n'); >> temp-check.js
echo. >> temp-check.js
echo   try { >> temp-check.js
echo     const products = await prisma.product.findMany({ >> temp-check.js
echo       where: { >> temp-check.js
echo         id: { in: [228365, 114979] } >> temp-check.js
echo       }, >> temp-check.js
echo       include: { >> temp-check.js
echo         images: { >> temp-check.js
echo           select: { url: true, order: true } >> temp-check.js
echo         } >> temp-check.js
echo       } >> temp-check.js
echo     }); >> temp-check.js
echo. >> temp-check.js
echo     console.log('Found ' + products.length + ' products\n'); >> temp-check.js
echo. >> temp-check.js
echo     for (const product of products) { >> temp-check.js
echo       console.log('Product ID: ' + product.id); >> temp-check.js
echo       console.log('Name: ' + product.name.substring(0, 60) + '...'); >> temp-check.js
echo       console.log('Images: ' + product.images.length); >> temp-check.js
echo. >> temp-check.js
echo       if (product.images.length > 0) { >> temp-check.js
echo         console.log('Image URLs:'); >> temp-check.js
echo         for (const image of product.images) { >> temp-check.js
echo           console.log('  - ' + image.url); >> temp-check.js
echo         } >> temp-check.js
echo       } >> temp-check.js
echo. >> temp-check.js
echo       console.log(''); >> temp-check.js
echo     } >> temp-check.js
echo. >> temp-check.js
echo   } catch (error) { >> temp-check.js
echo     console.error('Error:', error); >> temp-check.js
echo   } finally { >> temp-check.js
echo     await prisma.$disconnect(); >> temp-check.js
echo   } >> temp-check.js
echo } >> temp-check.js
echo. >> temp-check.js
echo checkProducts().catch(console.error); >> temp-check.js

REM Run the check
node temp-check.js

REM Clean up
del temp-check.js

echo.
echo ============================================
echo   Check Complete
echo ============================================
echo.
echo ✅ Finished checking example products.
echo.
echo 📝 To check ALL products for broken images, run:
echo    check-and-delete-broken.bat
echo.
pause
exit /b 0