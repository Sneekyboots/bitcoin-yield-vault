// Test script to check if ethers is available in Hardhat 3
async function main() {
  console.log("Testing ethers availability in Hardhat 3...");
  
  try {
    // Try different ways to access ethers
    const hre = await import("hardhat");
    console.log("HRE imported successfully");
    
    // Method 1: Check if ethers is on hre
    console.log("hre.ethers exists:", !!hre.ethers);
    
    // Method 2: Check global ethers
    console.log("global.ethers exists:", !!(global as any).ethers);
    
    // Method 3: Try to import ethers directly
    try {
      const { ethers } = await import("ethers");
      console.log("Direct ethers import successful");
      
      // Try to get signers using hardhat's provider
      const network = hre.network;
      console.log("Network name:", network.name);
      
      // For Hardhat 3, we might need to use the artifacts approach
      console.log("Testing artifact reading...");
      const SystemContractArtifact = await hre.artifacts.readArtifact("SystemContract");
      console.log("Artifact read successful:", !!SystemContractArtifact);
      
    } catch (error) {
      console.log("Direct ethers import failed:", error.message);
    }
    
  } catch (error) {
    console.log("Error:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });