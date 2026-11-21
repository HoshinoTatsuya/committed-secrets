/** Число символов, как его считает Python (`len`) — кодовые точки, а не единицы UTF-16. */
export const codePoints = (text: string): number => [...text].length;
