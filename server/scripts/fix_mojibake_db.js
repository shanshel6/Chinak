import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MOJIBAKE_MAP = {
    'ط§ظ„ظ…ط§ط±ظƒط©': 'الماركة',
    'ط§ظ„ظ„ظˆظ†': 'اللون',
    'ط§ظ„ظ…ظ‚ط§ط³': 'المقاس',
    'ط§ظ„ظ…ط§ط¯ط©': 'المادة',
    'ط§ظ„ظ…ظٹط²ط©': 'الميزة',
    'ط§ظ„طھطµظ…ظٹظ…': 'التصميم',
    'ط§ظ„ط§ط³طھط®ط¯ط§ظ…': 'الاستخدام',
    'ط§ط³ظ… ط؛ظٹط± ظ…طھظˆظپط±': 'اسم غير متوفر',
    'ط§ظ„ظ„ظˆظ† ط§ظ„ط§ظپطھط±ط§ط¶ظٹ': 'اللون الافتراضي',
    'ظƒظ…ط§ ظپظٹ ط§ظ„طµظˆط±ط©': 'كما في الصورة',
    'طھط®طµظٹطµ': 'تخصيص',
    'ط§طھطµط§ظ„': 'اتصال',
    'ط±ط§ط¨ط·': 'رابط',
    'ظپط±ظ‚': 'فرق',
    'ط¥ظٹط¯ط§ط¹': 'إيداع',
    'ظ„ط§ ظٹط±ط³ظ„': 'لا يرسل',
    'ط®ط¯ظ…ط© ط§ظ„ط¹ظ…ظ„ط§ط،': 'خدمة العملاء',
    'ظ…ط®طµطµ': 'مخصص'
};

async function fixMojibake() {
    console.log('Starting Mojibake Fixer...');
    
    // 1. Fix Products (Specs and Name)
    const products = await prisma.product.findMany();
    console.log(`Found ${products.length} products to check.`);

    for (const p of products) {
        let updated = false;
        let newSpecsStr = p.specs;
        let newName = p.name;

        // Fix Name
        for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
            if (newName && newName.includes(bad)) {
                newName = newName.split(bad).join(good);
                updated = true;
            }
        }

        // Fix Specs (JSON string)
        if (newSpecsStr) {
            for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
                if (newSpecsStr.includes(bad)) {
                    newSpecsStr = newSpecsStr.split(bad).join(good);
                    updated = true;
                }
            }
        }

        if (updated) {
            console.log(`Fixing Product ID: ${p.id}`);
            await prisma.product.update({
                where: { id: p.id },
                data: {
                    name: newName,
                    specs: newSpecsStr
                }
            });
        }
    }

    // 2. Fix ProductOptions (Name and Values)
    const options = await prisma.productOption.findMany();
    console.log(`Found ${options.length} options to check.`);

    for (const opt of options) {
        let updated = false;
        let newName = opt.name;
        let newValues = opt.values;

        // Fix Name
        for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
            if (newName && newName.includes(bad)) {
                newName = newName.split(bad).join(good);
                updated = true;
            }
        }

        // Fix Values (JSON string)
        if (newValues) {
            for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
                if (newValues.includes(bad)) {
                    newValues = newValues.split(bad).join(good);
                    updated = true;
                }
            }
        }

        if (updated) {
            console.log(`Fixing Option ID: ${opt.id}`);
            await prisma.productOption.update({
                where: { id: opt.id },
                data: {
                    name: newName,
                    values: newValues
                }
            });
        }
    }

    // 3. Fix ProductVariants (Combination)
    const variants = await prisma.productVariant.findMany();
    console.log(`Found ${variants.length} variants to check.`);

    for (const v of variants) {
        let updated = false;
        let newCombination = v.combination;

        if (newCombination) {
            for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
                if (newCombination.includes(bad)) {
                    newCombination = newCombination.split(bad).join(good);
                    updated = true;
                }
            }
        }

        if (updated) {
            console.log(`Fixing Variant ID: ${v.id}`);
            await prisma.productVariant.update({
                where: { id: v.id },
                data: {
                    combination: newCombination
                }
            });
        }
    }

    console.log('Mojibake Fix Complete.');
    fs.appendFileSync('e:/mynewproject2/fix_log_verbose.txt', 'Script finished\n');
}

fixMojibake()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
