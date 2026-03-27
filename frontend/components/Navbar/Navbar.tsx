export default function Navbar() {
    return (
        <nav className="w-full bg-gray-800 text-white p-4">
            <div className="container mx-auto flex justify-between items-center">
                <div className="text-lg font-bold">MyApp</div>
                <div className="space-x-4">
                    <a href="/" className="hover:text-gray-400">Home</a>
                    <a href="/dashboard" className="hover:text-gray-400">Dashboard</a>
                    <a href="/profile" className="hover:text-gray-400">Profile</a>
                </div>
            </div>
        </nav>
    )
}