// Subject rows for the /curriculum page, in display order.
//
// This file is the single place to edit curriculum copy. Each entry becomes
// one alternating image/text row on the page (odd rows: image left).
//
// Note: the page used to load its body from the Netlify function at
// /api/curriculum (src/lib/curriculumContent.ts + netlify/functions/
// curriculum-content.ts). That function still exists but the page no longer
// reads from it, so edits must be made here.
import type { ImageMetadata } from 'astro';

import storytimeImg from '../assets/images/storytime.webp';
import latinImg from '../assets/images/latin.webp';
import kodalyImg from '../assets/images/kodaly-old100.webp';
import creationImg from '../assets/images/creation.jpg';
import lecternImg from '../assets/images/lectern.webp';
import liberalArtsImg from '../assets/images/liberal-arts-full.webp';
import writingImg from '../assets/images/writing.webp';
import readingImg from '../assets/images/reading.webp';
import museumImg from '../assets/images/museum.webp';
import diggsImg from '../assets/images/diggs.webp';
import euclidImg from '../assets/images/euclid.webp';

import pictaDictaMono from '../assets/images/curriculum/picta-dicta-mono.png';
import iewMono from '../assets/images/curriculum/iew-mono.png';
import swrMono from '../assets/images/curriculum/swr-mono.png';
import bereanMono from '../assets/images/curriculum/berean-builders-mono.png';
import singaporeMono from '../assets/images/curriculum/singapore-math-mono.png';

export interface CurriculumSubject {
	/** Subject name, shown as the row heading. */
	name: string;
	/** Short mono label after the row number, e.g. "Primary E and up". */
	levels: string;
	/** One-line italic summary under the heading. */
	summary: string;
	/** Full rationale paragraph. */
	body: string;
	/** Program we teach it with. Shown as its logo when `logo` is set, otherwise as italic text. */
	program: string;
	logo?: ImageMetadata;
	image: ImageMetadata;
	imageAlt: string;
	/** CSS object-position for the photo crop (default centered). */
	imagePosition?: string;
	/** Show the whole image uncropped on a parchment background (used for the Grammar painting). */
	contain?: boolean;
}

export const curriculumSubjects: CurriculumSubject[] = [
	{
		name: 'Integrated Humanities',
		levels: 'Whole school, one cycle a year',
		summary: 'History, literature and Scripture read as one story.',
		body: 'Integrated humanities trains students to read history, literature, and Scripture as a single unfolding story, grasping not just what happened but what people loved, worshiped, and built. The whole school studies one historical cycle together each year, beginning with the Ancient cycle from creation through first-century Rome, so that every student shares in one great conversation about the world God is making.',
		program: 'Concordis Integrated Humanities',
		image: storytimeImg,
		imageAlt: 'A teacher sharing a picture book and a map with young students',
		imagePosition: '50% 50%',
	},
	{
		name: 'Latin',
		levels: 'Primary E and up',
		summary: 'Memory, grammar and precision.',
		body: 'Latin sharpens memory, grammar, and precision while handing students the key to the classical and Christian inheritance beneath Western civilization. We teach it through Picta Dicta, which pairs each word with an image rather than a translation list, because a language learned concretely is remembered and loved rather than merely memorized.',
		program: 'Picta Dicta',
		logo: pictaDictaMono,
		image: latinImg,
		imageAlt: 'John 1:1 in Latin, IN PRINCIPIO ERAT VERBVM, set as a carved Roman inscription',
	},
	{
		name: 'Music',
		levels: 'All students',
		summary: 'Music-makers, not music-consumers.',
		body: 'Music forms students into music-makers rather than music-consumers, training the voice, ear, body, and imagination together. We use the Kodály approach because God made a singing world and commands His Church to sing, and because it meets children where they naturally begin before growing them into real musical literacy.',
		program: 'The Kodály approach',
		image: kodalyImg,
		imageAlt: 'The opening of the Old Hundredth psalm tune with solfège syllables beneath the words',
	},
	{
		name: 'Art',
		levels: 'All students',
		summary: 'Seeing the world symbolically and biblically.',
		body: 'Art teaches students to see the world symbolically and biblically, reading stones, altars, temples, and cornerstones as the God-given signs they are. Our first-year course, "The Rock of Our Salvation," traces the ancient era from Creation to Constantine through more than thirty great works, because craftsmanship is a calling before God and the gospel triumphs over every pagan darkness.',
		program: 'The Rock of Our Salvation',
		image: creationImg,
		imageAlt: "Michelangelo's Creation of Adam, two hands reaching toward one another",
		imagePosition: '50% 50%',
	},
	{
		name: 'Logic',
		levels: 'Secondary Prep',
		summary: 'Clear thinking and honest argument.',
		body: "Logic equips students to think clearly, define their terms, and tell truth from faulty reasoning, which is the groundwork of honest and persuasive speech. We introduce our secondary prep students to Canon Press's Introductory Logic because a Christian must reason well to love God with the mind and defend the truth with charity.",
		program: 'Canon Press, Introductory Logic',
		image: lecternImg,
		imageAlt: 'Upper-school students listening at the lectern',
		imagePosition: '50% 50%',
	},
	{
		name: 'Grammar',
		levels: 'Woven through humanities',
		summary: 'Handling language with care.',
		body: "Grammar teaches students to handle language with care and precision, knowing that every word matters in loving God and neighbor well. We use the Well-Trained Mind's cyclical program and weave it through our humanities, so that grammar is applied and absorbed across everything they study rather than learned and forgotten.",
		program: 'The Well-Trained Mind',
		image: liberalArtsImg,
		imageAlt: 'Philosophy and the Seven Liberal Arts from the Hortus Deliciarum, with Grammar at the top of the circle',
		contain: true,
	},
	{
		name: 'Writing',
		levels: 'IEW, then the progymnasmata',
		summary: 'Ordered thinking, persuasive truth.',
		body: 'Writing forms students into clear, ordered thinkers who can shape their thoughts and persuade with truth. We build from the Institute for Excellence in Writing into the ancient progymnasmata, integrated across history, literature, and Bible, because writing should grow out of everything a student is learning.',
		program: 'Institute for Excellence in Writing',
		logo: iewMono,
		image: writingImg,
		imageAlt: 'Proverbs 1:7 handwritten as copywork on lined paper',
	},
	{
		name: 'Spelling & Phonics',
		levels: 'Early years',
		summary: 'The inner logic of English.',
		body: 'Spelling and phonics give students the inner logic of English, so that they read and spell by understanding rather than by memorizing. We use Spell to Write and Read (SWR) because a student who grasps how words actually work becomes a confident reader who can decode anything on his own.',
		program: 'Spell to Write and Read',
		logo: swrMono,
		image: readingImg,
		imageAlt: 'A teacher reading aloud to young students',
		imagePosition: '60% 45%',
	},
	{
		name: 'Geography',
		levels: 'Kindergarten to Secondary Prep',
		summary: 'The real world beneath the story.',
		body: 'Geography grounds everything students learn in history and literature in the physical reality of the world God made. Their journey runs from "blob mapping" the continents in kindergarten to drawing the whole world from memory, every country and capital, by their secondary prep years, because knowledge takes root when the hand and the eye learn together.',
		program: 'Hand-drawn maps',
		image: museumImg,
		imageAlt: 'Students on a field trip at a natural history museum',
		imagePosition: '40% 60%',
	},
	{
		name: 'Science',
		levels: 'In step with the history cycle',
		summary: 'Observing the order of creation.',
		body: "Science leads students to observe, experiment, and reason their way into the order and wonder of God's creation rather than merely memorize facts. We use Berean Builders because it follows the historical unfolding of discovery in step with the eras students study in humanities, weaving science into the larger story of civilization.",
		program: 'Berean Builders',
		logo: bereanMono,
		image: diggsImg,
		imageAlt: 'A teacher leading his cohort',
		imagePosition: '35% 40%',
	},
	{
		name: 'Mathematics',
		levels: 'All students, mastery-paced',
		summary: 'Not just what to think, but how.',
		body: "Mathematics teaches students not merely what to think but how to think, building deep understanding, number sense, and disciplined problem-solving. We use Singapore Math's mastery approach because slowing down to reason carefully helps students see the order and beauty God has woven into creation.",
		program: 'Singapore Math',
		logo: singaporeMono,
		image: euclidImg,
		imageAlt: "Euclid's proof of the Pythagorean theorem, drawn in the colored style of Oliver Byrne's 1847 edition",
	},
];
