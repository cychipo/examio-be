import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper function to convert Vietnamese text to slug
function toSlug(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

// Map category names to Lucide icon names
function getCategoryIcon(categoryName: string): string {
    const iconMap: Record<string, string> = {
        'Toán học': 'Calculator',
        'Khoa học Tự nhiên': 'Microscope',
        'Khoa học Xã hội': 'BookOpen',
        'Công nghệ & Tin học': 'MonitorSpeaker',
        'Ngoại ngữ': 'Languages',
        'Kỹ thuật & Công nghiệp': 'Settings',
        'Kinh tế – Kinh doanh – Quản lý': 'TrendingUp',
        'Luật & Chính sách': 'Scale',
        'Giáo dục & Sư phạm': 'GraduationCap',
        'Nghệ thuật & Nhân văn': 'Palette',
        'Sức khỏe & Thể chất': 'Activity',
        'Kỹ năng & Phát triển cá nhân': 'UserCheck',
    };
    return iconMap[categoryName] || 'BookOpen';
}

// Map subject names to Lucide icon names
function getSubjectIcon(subjectName: string): string {
    const iconMap: Record<string, string> = {
        // Toán học
        'Toán Tiểu học': 'Plus',
        'Toán Trung học': 'Divide',
        'Toán Phổ thông': 'Sigma',
        'Toán Đại học': 'FunctionSquare',

        // Khoa học Tự nhiên
        'Vật lý': 'Atom',
        'Hóa học': 'FlaskConical',
        'Sinh học': 'Dna',
        'Khoa học Tự nhiên (tích hợp)': 'Leaf',

        // Khoa học Xã hội
        'Ngữ văn': 'Book',
        'Lịch sử': 'Clock',
        'Địa lý': 'Map',
        'Giáo dục công dân': 'Shield',
        'Kinh tế học cơ bản': 'DollarSign',

        // Công nghệ & Tin học
        'Tin học phổ thông': 'Monitor',
        'Khoa học máy tính': 'HardDrive',
        'Công nghệ thông tin': 'Globe',
        'Trí tuệ nhân tạo & Dữ liệu': 'Bot',

        // Ngoại ngữ
        'Tiếng Anh': 'Flag',
        'Tiếng Pháp': 'Flag',
        'Tiếng Nhật': 'Flag',
        'Tiếng Hàn': 'Flag',
        'Tiếng Trung': 'Flag',

        // Kỹ thuật & Công nghiệp
        'Kỹ thuật điện – điện tử': 'Zap',
        'Cơ khí – cơ điện tử': 'Wrench',
        'Tự động hóa': 'Bot',
        'Viễn thông': 'Radio',

        // Kinh tế – Kinh doanh – Quản lý
        'Kinh tế học': 'BarChart3',
        'Quản trị kinh doanh': 'Building2',
        'Tài chính – Kế toán': 'Receipt',
        'Marketing': 'Megaphone',

        // Luật & Chính sách
        'Luật đại cương': 'Scroll',
        'Luật kinh tế': 'Briefcase',
        'Luật dân sự – lao động': 'Users',
        'Chính sách công': 'Building',

        // Giáo dục & Sư phạm
        'Giáo dục học': 'BookOpen',
        'Phương pháp giảng dạy': 'Presentation',
        'Công nghệ giáo dục': 'Laptop',

        // Nghệ thuật & Nhân văn
        'Âm nhạc': 'Music',
        'Mỹ thuật': 'Palette',
        'Văn hóa – Nghệ thuật': 'Theater',
        'Triết học': 'Brain',

        // Sức khỏe & Thể chất
        'Giáo dục thể chất': 'Dumbbell',
        'Khoa học sức khỏe': 'Heart',
        'Sinh học ứng dụng': 'TestTube',

        // Kỹ năng & Phát triển cá nhân
        'Kỹ năng sống': 'Sparkles',
        'Kỹ năng học tập': 'Lightbulb',
        'Tư duy phản biện': 'Brain',
        'Kỹ năng nghề nghiệp': 'Briefcase',
    };
    return iconMap[subjectName] || 'BookOpen';
}

// Generate system prompt template for each subject
function generateSystemPrompt(subjectName: string, categoryName: string): string {
    return `Bạn là một giáo viên AI chuyên môn về ${subjectName} thuộc lĩnh vực ${categoryName}.

NGUYÊN TẮC BẮT BUỘC:
1. CHỈ trả lời các câu hỏi liên quan đến ${subjectName}
2. Nếu câu hỏi KHÔNG thuộc phạm vi môn ${subjectName}, hãy TỪ CHỐI lịch sự và gợi ý học sinh hỏi giáo viên phù hợp
3. Giải thích rõ ràng, dễ hiểu, phù hợp với trình độ người học
4. Sử dụng ví dụ thực tế để minh họa
5. Khuyến khích tư duy phản biện và học tập chủ động

CÁCH TỪ CHỐI:
Khi nhận được câu hỏi ngoài phạm vi, hãy trả lời theo mẫu:
"Xin lỗi, câu hỏi này không thuộc phạm vi môn ${subjectName}. Tôi khuyên bạn nên hỏi giáo viên [tên môn phù hợp] để được hỗ trợ tốt nhất."

PHONG CÁCH GIẢNG DẠY:
- Thân thiện, kiên nhẫn
- Giải thích từ cơ bản đến nâng cao
- Đặt câu hỏi gợi mở để kiểm tra hiểu biết
- Cung cấp bài tập thực hành khi cần`;
}

// Subject categories and their subjects data
const subjectData = [
    {
        category: {
            name: 'Toán học',
            slug: 'toan-hoc',
            description: 'Các môn học về toán từ tiểu học đến đại học',
            icon: getCategoryIcon('Toán học'),
            color: '#3B82F6',
            order: 1,
        },
        subjects: [
            { name: 'Toán Tiểu học', icon: getSubjectIcon('Toán Tiểu học'), color: '#60A5FA' },
            { name: 'Toán Trung học', icon: getSubjectIcon('Toán Trung học'), color: '#3B82F6' },
            { name: 'Toán Phổ thông', icon: getSubjectIcon('Toán Phổ thông'), color: '#2563EB' },
            { name: 'Toán Đại học', icon: getSubjectIcon('Toán Đại học'), color: '#1D4ED8' },
        ],
    },
    {
        category: {
            name: 'Khoa học Tự nhiên',
            slug: 'khoa-hoc-tu-nhien',
            description: 'Vật lý, Hóa học, Sinh học và các môn khoa học tự nhiên',
            icon: getCategoryIcon('Khoa học Tự nhiên'),
            color: '#10B981',
            order: 2,
        },
        subjects: [
            { name: 'Vật lý', icon: getSubjectIcon('Vật lý'), color: '#34D399' },
            { name: 'Hóa học', icon: getSubjectIcon('Hóa học'), color: '#10B981' },
            { name: 'Sinh học', icon: getSubjectIcon('Sinh học'), color: '#059669' },
            { name: 'Khoa học Tự nhiên (tích hợp)', icon: getSubjectIcon('Khoa học Tự nhiên (tích hợp)'), color: '#047857' },
        ],
    },
    {
        category: {
            name: 'Khoa học Xã hội',
            slug: 'khoa-hoc-xa-hoi',
            description: 'Ngữ văn, Lịch sử, Địa lý và các môn xã hội',
            icon: getCategoryIcon('Khoa học Xã hội'),
            color: '#F59E0B',
            order: 3,
        },
        subjects: [
            { name: 'Ngữ văn', icon: getSubjectIcon('Ngữ văn'), color: '#FBBF24' },
            { name: 'Lịch sử', icon: getSubjectIcon('Lịch sử'), color: '#F59E0B' },
            { name: 'Địa lý', icon: getSubjectIcon('Địa lý'), color: '#D97706' },
            { name: 'Giáo dục công dân', icon: getSubjectIcon('Giáo dục công dân'), color: '#B45309' },
            { name: 'Kinh tế học cơ bản', icon: getSubjectIcon('Kinh tế học cơ bản'), color: '#92400E' },
        ],
    },
    {
        category: {
            name: 'Công nghệ & Tin học',
            slug: 'cong-nghe-tin-hoc',
            description: 'Tin học, CNTT, AI và các môn công nghệ',
            icon: getCategoryIcon('Công nghệ & Tin học'),
            color: '#6366F1',
            order: 4,
        },
        subjects: [
            { name: 'Tin học phổ thông', icon: getSubjectIcon('Tin học phổ thông'), color: '#818CF8' },
            { name: 'Khoa học máy tính', icon: getSubjectIcon('Khoa học máy tính'), color: '#6366F1' },
            { name: 'Công nghệ thông tin', icon: getSubjectIcon('Công nghệ thông tin'), color: '#4F46E5' },
            { name: 'Trí tuệ nhân tạo & Dữ liệu', icon: getSubjectIcon('Trí tuệ nhân tạo & Dữ liệu'), color: '#4338CA' },
        ],
    },
    {
        category: {
            name: 'Ngoại ngữ',
            slug: 'ngoai-ngu',
            description: 'Tiếng Anh, Tiếng Pháp, Tiếng Nhật và các ngôn ngữ khác',
            icon: getCategoryIcon('Ngoại ngữ'),
            color: '#EC4899',
            order: 5,
        },
        subjects: [
            { name: 'Tiếng Anh', icon: getSubjectIcon('Tiếng Anh'), color: '#F472B6' },
            { name: 'Tiếng Pháp', icon: getSubjectIcon('Tiếng Pháp'), color: '#EC4899' },
            { name: 'Tiếng Nhật', icon: getSubjectIcon('Tiếng Nhật'), color: '#DB2777' },
            { name: 'Tiếng Hàn', icon: getSubjectIcon('Tiếng Hàn'), color: '#BE185D' },
            { name: 'Tiếng Trung', icon: getSubjectIcon('Tiếng Trung'), color: '#9D174D' },
        ],
    },
    {
        category: {
            name: 'Kỹ thuật & Công nghiệp',
            slug: 'ky-thuat-cong-nghiep',
            description: 'Điện tử, Cơ khí, Tự động hóa và các ngành kỹ thuật',
            icon: getCategoryIcon('Kỹ thuật & Công nghiệp'),
            color: '#64748B',
            order: 6,
        },
        subjects: [
            { name: 'Kỹ thuật điện – điện tử', icon: getSubjectIcon('Kỹ thuật điện – điện tử'), color: '#94A3B8' },
            { name: 'Cơ khí – cơ điện tử', icon: getSubjectIcon('Cơ khí – cơ điện tử'), color: '#64748B' },
            { name: 'Tự động hóa', icon: getSubjectIcon('Tự động hóa'), color: '#475569' },
            { name: 'Viễn thông', icon: getSubjectIcon('Viễn thông'), color: '#334155' },
        ],
    },
    {
        category: {
            name: 'Kinh tế – Kinh doanh – Quản lý',
            slug: 'kinh-te-kinh-doanh-quan-ly',
            description: 'Kinh tế, Quản trị, Tài chính và Marketing',
            icon: getCategoryIcon('Kinh tế – Kinh doanh – Quản lý'),
            color: '#22C55E',
            order: 7,
        },
        subjects: [
            { name: 'Kinh tế học', icon: getSubjectIcon('Kinh tế học'), color: '#4ADE80' },
            { name: 'Quản trị kinh doanh', icon: getSubjectIcon('Quản trị kinh doanh'), color: '#22C55E' },
            { name: 'Tài chính – Kế toán', icon: getSubjectIcon('Tài chính – Kế toán'), color: '#16A34A' },
            { name: 'Marketing', icon: getSubjectIcon('Marketing'), color: '#15803D' },
        ],
    },
    {
        category: {
            name: 'Luật & Chính sách',
            slug: 'luat-chinh-sach',
            description: 'Luật đại cương, Luật kinh tế, Luật dân sự và Chính sách công',
            icon: getCategoryIcon('Luật & Chính sách'),
            color: '#A855F7',
            order: 8,
        },
        subjects: [
            { name: 'Luật đại cương', icon: getSubjectIcon('Luật đại cương'), color: '#C084FC' },
            { name: 'Luật kinh tế', icon: getSubjectIcon('Luật kinh tế'), color: '#A855F7' },
            { name: 'Luật dân sự – lao động', icon: getSubjectIcon('Luật dân sự – lao động'), color: '#9333EA' },
            { name: 'Chính sách công', icon: getSubjectIcon('Chính sách công'), color: '#7E22CE' },
        ],
    },
    {
        category: {
            name: 'Giáo dục & Sư phạm',
            slug: 'giao-duc-su-pham',
            description: 'Giáo dục học, Phương pháp giảng dạy và Công nghệ giáo dục',
            icon: getCategoryIcon('Giáo dục & Sư phạm'),
            color: '#EAB308',
            order: 9,
        },
        subjects: [
            { name: 'Giáo dục học', icon: getSubjectIcon('Giáo dục học'), color: '#FACC15' },
            { name: 'Phương pháp giảng dạy', icon: getSubjectIcon('Phương pháp giảng dạy'), color: '#EAB308' },
            { name: 'Công nghệ giáo dục', icon: getSubjectIcon('Công nghệ giáo dục'), color: '#CA8A04' },
        ],
    },
    {
        category: {
            name: 'Nghệ thuật & Nhân văn',
            slug: 'nghe-thuat-nhan-van',
            description: 'Âm nhạc, Mỹ thuật, Văn hóa và Triết học',
            icon: getCategoryIcon('Nghệ thuật & Nhân văn'),
            color: '#F43F5E',
            order: 10,
        },
        subjects: [
            { name: 'Âm nhạc', icon: getSubjectIcon('Âm nhạc'), color: '#FB7185' },
            { name: 'Mỹ thuật', icon: getSubjectIcon('Mỹ thuật'), color: '#F43F5E' },
            { name: 'Văn hóa – Nghệ thuật', icon: getSubjectIcon('Văn hóa – Nghệ thuật'), color: '#E11D48' },
            { name: 'Triết học', icon: getSubjectIcon('Triết học'), color: '#BE123C' },
        ],
    },
    {
        category: {
            name: 'Sức khỏe & Thể chất',
            slug: 'suc-khoe-the-chat',
            description: 'Giáo dục thể chất, Khoa học sức khỏe và Sinh học ứng dụng',
            icon: getCategoryIcon('Sức khỏe & Thể chất'),
            color: '#14B8A6',
            order: 11,
        },
        subjects: [
            { name: 'Giáo dục thể chất', icon: getSubjectIcon('Giáo dục thể chất'), color: '#2DD4BF' },
            { name: 'Khoa học sức khỏe', icon: getSubjectIcon('Khoa học sức khỏe'), color: '#14B8A6' },
            { name: 'Sinh học ứng dụng', icon: getSubjectIcon('Sinh học ứng dụng'), color: '#0D9488' },
        ],
    },
    {
        category: {
            name: 'Kỹ năng & Phát triển cá nhân',
            slug: 'ky-nang-phat-trien-ca-nhan',
            description: 'Kỹ năng sống, Kỹ năng học tập, Tư duy và Kỹ năng nghề nghiệp',
            icon: getCategoryIcon('Kỹ năng & Phát triển cá nhân'),
            color: '#8B5CF6',
            order: 12,
        },
        subjects: [
            { name: 'Kỹ năng sống', icon: getSubjectIcon('Kỹ năng sống'), color: '#A78BFA' },
            { name: 'Kỹ năng học tập', icon: getSubjectIcon('Kỹ năng học tập'), color: '#8B5CF6' },
            { name: 'Tư duy phản biện', icon: getSubjectIcon('Tư duy phản biện'), color: '#7C3AED' },
            { name: 'Kỹ năng nghề nghiệp', icon: getSubjectIcon('Kỹ năng nghề nghiệp'), color: '#6D28D9' },
        ],
    },
];

async function seedSubjects() {
    console.log('🌱 Seeding Subject Categories and Subjects...\n');

    let categoryCount = 0;
    let subjectCount = 0;

    for (const data of subjectData) {
        // Upsert category
        const category = await prisma.subjectCategory.upsert({
            where: { slug: data.category.slug },
            update: {
                name: data.category.name,
                description: data.category.description,
                icon: data.category.icon,
                color: data.category.color,
                order: data.category.order,
            },
            create: {
                name: data.category.name,
                slug: data.category.slug,
                description: data.category.description,
                icon: data.category.icon,
                color: data.category.color,
                order: data.category.order,
            },
        });

        categoryCount++;
        console.log(`✅ Category: ${category.name}`);

        // Upsert subjects in this category
        for (let i = 0; i < data.subjects.length; i++) {
            const subjectInfo = data.subjects[i];
            const slug = toSlug(subjectInfo.name);

            const subject = await prisma.subject.upsert({
                where: { slug },
                update: {
                    name: subjectInfo.name,
                    categoryId: category.id,
                    icon: subjectInfo.icon,
                    color: subjectInfo.color,
                    order: i + 1,
                    systemPrompt: generateSystemPrompt(
                        subjectInfo.name,
                        data.category.name,
                    ),
                },
                create: {
                    name: subjectInfo.name,
                    slug,
                    categoryId: category.id,
                    icon: subjectInfo.icon,
                    color: subjectInfo.color,
                    order: i + 1,
                    systemPrompt: generateSystemPrompt(
                        subjectInfo.name,
                        data.category.name,
                    ),
                },
            });

            subjectCount++;
            console.log(`   └─ Subject: ${subject.name}`);
        }

        console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🎉 Seeding completed!`);
    console.log(`   📁 Categories: ${categoryCount}`);
    console.log(`   📚 Subjects: ${subjectCount}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

async function main() {
    try {
        await seedSubjects();
    } catch (error) {
        console.error('❌ Error seeding:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
